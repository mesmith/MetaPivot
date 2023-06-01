const dotenv = require('dotenv');
dotenv.config({path: __dirname + '/../../../.env'});

const env = function(){
  return process
    ? {
        database_url: process.env.DATABASE_URL,
        connect: process.env.CONNECT,
        customer: process.env.CUSTOMER,
        api_key: process.env.API_KEY,
        home: process.env.HOME,
      }
    : {};
}();

module.exports = env;
