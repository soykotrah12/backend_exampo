// // redis.js
// const redis = require('redis');
// // const config = require('config');

// const redisClient = redis.createClient({
//   url: process.env.REDIS_URL,
// });

// redisClient.on('connect', () => console.log('Connected to Redis!'));
// redisClient.on('error', (err) => {
//   console.error('Error connecting to Redis:', err);
// });






// module.exports = redisClient

// redis.js
const redis = require("redis");
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));

(async () => {
  try {
    await redisClient.connect();
    console.log("Redis connected");
  } catch (error) {
    console.error("Redis connection failed:", error);
  }
})();

module.exports = redisClient;
