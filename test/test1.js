const logger = require("nodelogger");
var ConnectIPC = require('../lib/ipcClass');

const connectIPC = new ConnectIPC("SERVER_1", (err)=>{
  if(err) {
    logger.err(err);
  }
  else {
    connectIPC.IPC.startListening();
    connectIPC.IPC.send({dest: "SERVER_2", a: "handler_1", d: {count:1}}, (err, data)=>{
      if(err){
        logger.err(err);
      }
      else {
        console.log("-----final-------->data", data)
      }  
    });
  }  
});

