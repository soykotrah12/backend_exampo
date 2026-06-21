const { Server } = require("socket.io");
// const { createAdapter } = require("@socket.io/redis-adapter");
// const redisClient = require("./redis");
const jwt = require("jsonwebtoken");
const User = require("./V2/model/user");
const AppError = require("./V2/errors/AppError");


let io;

const initializeSocketIO = (server) => {
  // io = socketIo(server, {
  //   pingTimeout: 60000,
  // });
  io = new Server(server, {
    pingTimeout: 60000,
    cors: {
      origin: "*",
    },
  });
  try {
    // const subClient = redisClient.duplicate();
    // io.adapter(createAdapter(redisClient, subClient));
    // io.use(this.authenticateSocket);
  } catch (e) {
    console.log(e.message);
    throw new AppError(400, "Invalid token")

  }

  // You can add your Socket.IO event listeners here.
  // For example:
  // io.on("connection", (socket) => {
  //   console.log("A user connected");
  // });

  return io;
};

// exports.authenticateSocket = async (socket, next) => {
//   try {
//  const token = socket.handshake.auth.token;
//      const user = jwt.verify(token, process.env.JWT_SECRET);
//      let findUser = await User.findById(user._id)
//      .select("_id email firstName lastName profilePicture role fullName")
//      .exec();

//      console.log("sdjlkfhsd ",findUser)

//    if (!findUser) {
//      // return res.status(400).json({ error: "Invalid token" });
//      next(new Error(400," Invalid token"))
//    }
//    socket.user = findUser
//    next();
//    } catch (e) {
//     console.log(e.message)
//     next(new Error("Invalid token"))
//     }
// }

const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO is not initialized");
  }
  return io;
};

module.exports = {
  initializeSocketIO,
  getIO,
};