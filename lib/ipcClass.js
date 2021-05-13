const logger = require("nodelogger");
const ConnectDB = require('./dbClient');
const CONFIG = require('../config');

var Q_MAP = {};
const mType = {
  REQ: 1,
  RESP: 2
};

function validateServerName(name){
  if(!Q_MAP[name]) {
    logger.error("Server Name not present");
    return false;
  }
  return name;
}

function __validateParams(obj){
  if(!obj.dest) {
    logger.error("missing destination key: dest");
    return false;
  }
  else if(!validateServerName(obj.dest)){
    logger.error("Wrong destination key: dest");
    return false;
  }

  if(!obj.a) {
    logger.error("missing action key: a");
    return false;
  }

  return true;
}

function getErrorMessage(SERVER_NAME, action, string){
  if(string)
    return SERVER_NAME + " : " + action + " : " + string;
  else return null;
}

class ConnectIPC{
  constructor(serverName, cb){
    var self = this;
    var connection = new ConnectDB((redisPush, redisPop)=>{
      if(!redisPush || !redisPop) {
        return logger.error("Connection Error");
      }
      this.IPC = new IPC(serverName, redisPush, redisPop, (err)=>{
        if(err){
          logger.error(err);
          throw err;
        }
        else {
          logger.info("IPC initialized");
          cb();
        }  
      });      
    });
  }
}

class IPC {
  constructor(serverName, redisPush, redisPop, cb){
    if(redisPush) this.redisPush = redisPush;
    else throw "IPC:redisPush: client not defined";

    if(redisPop) this.redisPop = redisPop;
    else throw "IPC:redisPop: client not defined";

    this.SERVER_NAME = serverName;

    Q_MAP = CONFIG.IPC_Q;

    redisPush.hmget(CONFIG.HASH_MAPS.SERVER_MAP, serverName, (err, data)=>{
      if(err){
        logger.error("Error while reading Server Map", err);
        return cb(new Error("Error while reading Server Map"), null);
      }
      else {
        var serverInfo = JSON.parse(data[0]); //Data in Redis save in String
        if(!serverInfo) serverInfo = {};

        this.qname = Q_MAP[this.SERVER_NAME];
        if(!this.qname) return cb("No queue found for server name " + serverName);
        else logger.info("Server will listen to queue " + this.qname);

        /* Use to check the unique the request and resposd */
        this.latestTranxId = serverInfo.tid;
        if(!this.latestTranxId) this.latestTranxId = 0;

        this.actionMap = {};
        this.responseMap = {};

        cb(null, "ok");
      }
    });
  }

  _getTransactionID(){
    this.latestTranxId += 1;
    if(this.latestTranxId > CONFIG.TRANSACTION_NUMBER_THRESH) this.latestTranxId = 0;
    return this.latestTranxId;
  }

  isHandler(action){
    if(this.actionMap && this.actionMap[action]) return true;
    else return false;
  }

  _attachToActionMap(action, handler){
    if(!this.actionMap[action]) this.actionMap[action] = handler;
  }

  addActionHandler(action, handler){
    if(this.isHandler(action)){
      logger.error("Handler already attached");
      return -1;
    }

    if(this.actionMap[action] && this.actionMap[action].length > 0){
      logger.error("More than one handler not allowed for an action :", action);
      return -1;
    }

    this._attachToActionMap(action, handler);
  }

  removeActionHandler(action){
    logger.info("removeActionHandler", action);
    if(!this.isHandler(action)){
      logger.error("Handler not found in action", action);
      return -1;
    }
    else{
      delete this.actionMap[action];
      return true;
    }
  }
  /*messages = { dest: DESTINATION_SERVER_NAME, a: ACTION, d: DATA}*/
  send(message, cb){
    var data = message;
     var d_snm; // destination server name
    if(!data){
      logger.error("Response Msg not found");
      if(cb) cb(new Error("Response Msg not found"));
      return;
    }
    if(!data.msgTyp || data.msgTyp === mType.REQ){
      if(!__validateParams(message)){
        if(cb) cb(new Error("IPC:send: Validation failed"))
        return;
      }
      var tranxId = this._getTransactionID();
      d_snm = message.dest;
      data.tid = tranxId;
      data.snm = this.SERVER_NAME;
      data.msgTyp = mType.REQ;
    }
    else if(message.msgTyp == mType.RESP){
      d_snm = data.snm
      data.snm = this.SERVER_NAME;
      data.d_snm = d_snm;
    }
    else {
      logger.error("Unknown message type for message", message);
      if(cb) return cb(new Error("IPC:Unknown message type for message"), message);
    }
    var self = this;
    this.redisPush.lpush(Q_MAP[d_snm], JSON.stringify(message), function(err, result) {
      if (err) {
        logger.error(data, 'error', err);
        if(cb) cb(new Error("IPC:_pushToServer: Error while pushing data to queue"));
      }
      else {
        if(cb){
          self.responseMap = { callback: cb, ts:  Date.now(), d_snm: d_snm};
          // if the response is not received within timeout interval.
          setTimeout(function(){
            if(self.responseMap[tranxId]){
              self.responseMap[tranxId].callback(new Error("IPC: Response timeout for TID:"+ tranxId + " for SERVER:" + d_snm));
              delete self.responseMap[tranxId];
            }
          }, CONFIG.RESP_TIMEOUT_THRES);
        }
      }
    });
  }

  startListening(){
    logger.debug("Starting listener at queue", this.qname);
    this.listener();
  }

  listener(){
    this.redisPop.brpop(this.qname, CONFIG.POP_TIMEOUT,(err, data)=>{
      if(err){
        logger.error("Error while popping data from queue", err);
        this.listener();
      }
      else{
        try{
          if(data){
            var jsonObj = JSON.parse(data[1]);
            if(jsonObj.msgTyp === mType.RESP) {
              if(this.responseMap[jsonObj.tid]){
                this.responseMap[jsonObj.tid].callback(jsonObj.err ? new Error(jsonObj.err) : null, jsonObj.data);
                delete this.responseMap[jsonObj.tid];
              }
            }
            else this.runActionHandlers(jsonObj);
          }
          this.listener();
        }
        catch(e){
          logger.error("listener: JSON.parse error", e);
          this.listener();
        }
      }
    })
  }

  sendResponse(reqData, err, data){
    reqData.err = err;
    reqData.data = data;
    reqData.msgTyp = mType.RESP;
    this.send(reqData);
  }

  runActionHandlers(json){
    if(!this.actionMap[json.a]){
      logger.error("runActionHandlers: Action is not present", json);
      this.sendResponse(json, getErrorMessage(this.SERVER_NAME, json.a, "Action is not present"), null);
      return;
    }
    else {
      this.actionMap[json.a](json.err, json, (e, d)=>{
        if(e) {
          if(typeof e != "string"){
            logger.error("Error should be a string.")
            return;
          }
        }
        this.sendResponse(json, getErrorMessage(this.SERVER_NAME, json.a, e), d);
      })
    }
  }
}

module.exports = ConnectIPC;
