const Redis = require("ioredis");
/* 
  You can Specify port and other addition details while creating instance
  refer: https://www.npmjs.com/package/ioredis
*/
const redisPush = new Redis();
const redisPop = new Redis();

class ConnectDB{
  constructor(callback){
    redisPush.on("connect", () => {
      redisPop.on("connect", () => {
        callback(redisPush, redisPop);
      },function(redisPopErr){
        logger.error('REDIS_POP not connected',redisPopErr)
      });
    },(redisPushErr)=>{
      logger.error('REDIS_PUSH not connected', redisPushErr)
    });
  }
}

module.exports = ConnectDB;