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
        domain: '.ledsflow.cloud',
        secure: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
});

module.exports = sessionConfig;
