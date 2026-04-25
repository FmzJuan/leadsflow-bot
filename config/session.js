const session = require('express-session');
const RedisStore = require("connect-redis").default;
const redisClient = require('../DataBase/redis');

const sessionConfig = session({
    store: new RedisStore({ client: redisClient, prefix: "sess:" }),
    secret: process.env.SESSION_SECRET || 'secret_flow',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
    domain: process.env.NODE_ENV === 'development' ? undefined : '.ledsflow.cloud',
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
}
    /*//mudar para true quando subir para a vps
    cookie: {
        domain: '.ledsflow.cloud',
         
        secure: true,
        sameSite: 'lax',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }*/
});

module.exports = sessionConfig;
