const logger = require("nodelogger");
var ConnectIPC = require('../lib/ipcClass');

const connectIPC = new ConnectIPC("SERVER_2", (err)=>{
  if(err) {
    logger.err(err);
  }
  else {
    connectIPC.IPC.startListening();
    connectIPC.IPC.addActionHandler("handler_1", (err, data, cb)=> {
        data = data.d
        data.count += 2;
        cb(null, data);
    });
  }  
});