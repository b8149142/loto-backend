require("dotenv").config();
const express = require("express");
const app = express();
const WSServer = require("express-ws")(app);
const aWss = WSServer.getWss();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const router = require("./router/index");
const errorMiddleware = require("./middlewares/error-middleware");
const axios = require("axios");
const { Sequelize } = require("sequelize");
const {
  Loto,
  LotoGame,
  LotoCard,
  LotoSetting,
  Stats,
  BotStats,
  Bot,
} = require("./models/db-models");
const AdminLotoService = require("./service/loto-admin-service");
const gameService = require("./service/game-service");
const lotoAdminService = require("./service/loto-admin-service");
const roomsFunctions = require("./service/loto-rooms-functions");

const PORT = process.env.PORT || 5001;

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
  })
);
app.use("/api", router);
app.use(errorMiddleware);

const start = async () => {
  try {
    const sequelize = require("./db");
    await sequelize.authenticate();
    await sequelize.sync();

    // for (let i = 0; i < 20; i++) {
    //   const randomUserdata = await axios.get(
    //     "https://random-data-api.com/api/v2/users"
    //   );
    //   const username = randomUserdata.data.first_name;
    //   await Bot.create({ username });
    // }

    // await LotoGame.update(
    //   {
    //     bots: 0,
    //     isStarted: false,
    //     isWaiting: false,
    //     startedAt: null,
    //     finishesAt: null,
    //     prevBank: 0,
    //     botsTickets: JSON.stringify([]),
    //   },
    //   { where: { gameLevel: [1, 2, 3, 4, 5] } }
    // );
    // await LotoCard.destroy({ where: {} });

    // await BotStats.create();
    // await LotoGame.create({ gameLevel: 1 });
    // await LotoGame.create({ gameLevel: 2 });
    // await LotoGame.create({ gameLevel: 3 });
    // await LotoGame.create({ gameLevel: 4 });
    // await LotoGame.create({ gameLevel: 5 });
    // await LotoSetting.create({
    //   gameLevel: 1,
    //   allowBots: true,
    //   maxBots: 4,
    //   maxTickets: 6,
    //   winChance: 20,
    // });
    // await LotoSetting.create({
    //   gameLevel: 2,
    //   allowBots: true,
    //   maxBots: 4,
    //   maxTickets: 6,
    //   winChance: 20,
    // });
    // await LotoSetting.create({
    //   gameLevel: 3,
    //   allowBots: true,
    //   maxBots: 4,
    //   maxTickets: 6,
    //   winChance: 20,
    // });

    // await LotoSetting.create({
    //   gameLevel: 4,
    //   allowBots: true,
    //   maxBots: 4,
    //   maxTickets: 6,
    //   winChance: 20,
    // });
    // await LotoSetting.create({
    //   gameLevel: 5,
    //   allowBots: true,
    //   maxBots: 4,
    //   maxTickets: 6,
    //   winChance: 20,
    // });

    // await Stats.create({
    //   userId: 1,
    // });
    // await Stats.create({
    //   userId: 4,
    // });

    app.listen(PORT, () => console.log(`Server started on PORT = ${PORT}`));
  } catch (e) {
    console.log(e);
  }
};

start();

const timeouts = [
  { roomId: 1, timeoutId: null, timeoutStarted: false },
  { roomId: 2, timeoutId: null, timeoutStarted: false },
  { roomId: 3, timeoutId: null, timeoutStarted: false },
  { roomId: 4, timeoutId: null, timeoutStarted: false },
  { roomId: 5, timeoutId: null, timeoutStarted: false },
];

// web sockets для подключения к играм
app.ws("/game", (ws, req) => {
  ws.on("message", async (msg) => {
    msg = JSON.parse(msg);

    switch (msg.method) {
      case "connectGeneral":
        broadcastMenu(ws, msg);
        // отправка всем об онлайне в меню
        let rooms = await roomsFunctions.getAllRoomsOnline(aWss);
        roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: rooms });

        // отправка всем о джекпотах в меню
        let roomsJackpots = await roomsFunctions.checkAllJackpots();
        roomsFunctions.sendAll(aWss, "updateAllRoomsJackpot", {
          jackpots: roomsJackpots,
        });
        // отправка всем о ставке в меню
        let roomsBet = await roomsFunctions.checkAllBets();
        roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });

        // отправка всем о начале игры в меню
        let roomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
        roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
          timers: roomsStartTimer,
        });

        // отправка всем о конце игры в меню
        let roomsFinishTimer = await roomsFunctions.getAllRoomsFinishTimers();
        roomsFunctions.sendAll(aWss, "allRoomsFinishTimers", {
          timers: roomsFinishTimer,
        });

        // отправка всем о последнем банке в играх
        let prevBank = await roomsFunctions.getAllPrevBets();
        roomsFunctions.sendAll(aWss, "updateAllRoomsPrevBank", {
          prevBank: prevBank,
        });

        break;
      case "getAllInfo":
        // отправка всем об онлайне в меню
        let allRoomsOnline = await roomsFunctions.getAllRoomsOnline(aWss);
        roomsFunctions.sendAll(aWss, "allRoomsOnline", {
          rooms: allRoomsOnline,
        });
        // отправка всем о джекпотах в меню
        let allRoomsJackpots = await roomsFunctions.checkAllJackpots();
        roomsFunctions.sendAll(aWss, "updateAllRoomsJackpot", {
          jackpots: allRoomsJackpots,
        });
        // отправка всем о ставке в меню
        let allRoomsBet = await roomsFunctions.checkAllBets();
        roomsFunctions.sendAll(aWss, "updateAllRoomsBank", {
          bank: allRoomsBet,
        });

        // отправка всем о начале игры в меню
        let allRoomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
        roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
          timers: allRoomsStartTimer,
        });

        // отправка всем о конце игры в меню
        let allRoomsFinishTimer =
          await roomsFunctions.getAllRoomsFinishTimers();
        roomsFunctions.sendAll(aWss, "allRoomsFinishTimers", {
          timers: allRoomsFinishTimer,
        });

        break;

      case "connectGame":
        // let timerStarted;
        // // get online (bots and players) in room
        // const gameState = await LotoGame.findOne({
        //   where: { gameLevel: msg.roomId },
        // });

        // if (gameState.isWaiting && gameState.startedAt != null) {
        //   timerStarted = true;
        // } else timerStarted = false;

        // let roomOnlineWithBots = await checkPeopleOnline(msg.roomId);

        // roomOnlineWithBots += gameState.bots;

        // // начало игры
        // if (roomOnlineWithBots >= 3 && gameState.isWaiting == false) {
        //   if (!timerStarted) {
        //     setTimeout(async () => {
        //       await gameService.startLotoGame(ws, aWss, msg);
        //     }, 30000);
        //   }
        // }
        await gameConnectionHandler(ws, msg);

        await gameService.startRoomLobby(ws, aWss, msg);

        await gameService.checkBet(ws, aWss, msg);
        await roomsFunctions.checkJackpot(ws, aWss, msg);

        // // отправка всем о ставке в меню
        // let gameRoomsBet = await roomsFunctions.checkAllBets();
        // roomsFunctions.sendAll(aWss, "updateAllRoomsBank", {
        //   bank: gameRoomsBet,
        // });

        break;
      case "buyTickets":
        let isBought = await gameService.gameBuyTickets(ws, msg);
        if (isBought) {
          sendTicketsToClient(ws, msg);
          await AdminLotoService.createBot(ws, aWss, msg);
        } else {
          ws.send(JSON.stringify({ method: "buyTickets", isBought: false }));
        }
        break;
      case "cancelCard":
        const cardId = msg.cardId;
        await LotoCard.update({ isActive: false }, { where: { id: cardId } });
    }
  });

  ws.on("close", async (status, msg) => {
    if (status > 1000) {
      // let roomOnline = await checkPeopleOnline();
      // let gameStates = await LotoGame.findAll();

      // for (const game of gameStates) {
      //   if (
      //     game.bots > 0 &&
      //     Boolean(game.isStarted) == false &&
      //     Boolean(game.isWaiting) == false
      //   ) {
      //     await lotoAdminService.deleteBots(roomOnline);
      //   }
      // }

      // removeTimeout(roomOnline);

      // обновить онлайн во всех комнатах на клиенте
      let roomsOnline = await roomsFunctions.getAllRoomsOnline(aWss);
      roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: roomsOnline });

      // // отправка всем о ставке в меню
      // let roomsBet = await roomsFunctions.checkAllBets();
      // roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });

      return;
    }
    msg = JSON.parse(msg);
    await gameDisconnectHandler(ws, msg);
    // отправка всем о начале игры в меню
    let roomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
    roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
      timers: roomsStartTimer,
    });
  });
});

const gameDisconnectHandler = async (ws, msg) => {
  switch (msg.method) {
    // case "exitGame":
    //   await LotoCard.destroy({ where: { userId: msg.userId } });
    //   break;
    case "disconnectGame":
      ws.roomId = msg.roomId;
      await gameService.checkBet(ws, aWss, msg);
      await roomsFunctions.checkJackpot(ws, aWss, msg);

      let roomOnline = await checkPeopleOnline(msg.roomId);
      // if (roomOnline == 0) {
      //   removeTimeout(roomOnline, msg.roomId);
      //   await lotoAdminService.deleteBots(roomOnline, msg.roomId);
      // }
      // отправка всем о ставке в меню
      // let roomsBet = await roomsFunctions.checkAllBets();
      // roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });
      // await AdminLotoService.deleteBot(ws, aWss, msg);
      broadcastGame(ws, msg);
      break;
  }
};

function removeTimeout(roomOnline, roomId = null) {
  if (roomId) {
    let timeout = timeouts.find((timeout) => timeout.roomId == roomId);
    clearTimeout(timeout.timeoutId);
  } else {
    for (let room = 1; room <= 5; room++) {
      const roomId = room;
      if (roomOnline[`room${roomId}`] === 0) {
        let timeout = timeouts.find((timeout) => timeout.roomId == roomId);
        clearTimeout(timeout.timeoutId);
      }
    }
  }
}

const sendTicketsToClient = async (ws, msg) => {
  ws.username = msg.user;
  for (const client of aWss.clients) {
    if (client.username == msg.user) {
      client.send(JSON.stringify(msg));
    }
  }

  await gameService.checkBet(ws, aWss, msg);
  await roomsFunctions.checkJackpot(ws, aWss, msg);

  // отправка всем о джекпотах в меню
  let roomsJackpots = await roomsFunctions.checkAllJackpots();
  roomsFunctions.sendAll(aWss, "updateAllRoomsJackpot", {
    jackpots: roomsJackpots,
  });

  // отправка всем о ставке в меню
  let roomsBet = await roomsFunctions.checkAllBets();
  roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });
};

const checkPeopleOnline = async (roomId = null) => {
  if (roomId) {
    let roomOnline = 0;
    aWss.clients.forEach((client) => {
      if (client.roomId == roomId) {
        roomOnline++;
      }
    });

    // if (roomOnline == 0) {
    //   // await LotoGame.update(
    //   //   { startedAt: null, isStarted: false, isWaiting: false },
    //   //   {
    //   //     where: { gameLevel: roomId },
    //   //   }
    //   // );
    //   // await LotoCard.destroy({
    //   //   where: { gameLevel: roomId },
    //   // });
    // }

    return roomOnline;
  } else {
    let rooms = {
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    };
    for (let room = 1; room <= 5; room++) {
      const roomId = room;

      // get every room online
      roomOnline = 0;
      aWss.clients.forEach((client) => {
        if (client.roomId == roomId) {
          roomOnline++;
        }
      });

      rooms[`room${roomId}`] = roomOnline;

      // if (roomOnline == 0) {
      //   let lotoGameInfo = await LotoGame.findOne({
      //     where: { gameLevel: roomId },
      //   });

      //   if (lotoGameInfo.isStarted != true) {
      //     await LotoGame.update(
      //       { startedAt: null, isStarted: false, isWaiting: false },
      //       {
      //         where: { gameLevel: roomId },
      //       }
      //     );
      //     // await LotoCard.destroy({
      //     //   where: { gameLevel: roomId },
      //     // });
      //   }
      // }
    }
    return rooms;
  }
};

const gameConnectionHandler = async (ws, msg) => {
  ws.roomId = msg.roomId;
  ws.userId = msg.userId;
  ws.username = msg.username;
  broadcastGame(ws, msg);
};

const broadcastGame = async (ws, msg) => {
  let userCounter = 0;
  aWss.clients.forEach((client) => {
    if (client.username == msg.username) {
      userCounter++;
      disconnectexistingClient(userCounter, client);
    }
  });

  // // запуск таймера
  // let timerStartedAt = await startRoomTimer(msg);
  // if (timerStartedAt) {
  //   msg.startedAt = timerStartedAt;
  //   // отправка всем о начале игры в меню
  //   let roomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
  //   roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
  //     timers: roomsStartTimer,
  //   });
  // }

  // получение информации об игре
  const game = await LotoGame.findOne({
    where: { gameLevel: msg.roomId },
  });

  // get room online
  let roomOnline = 0;
  let users = [];
  aWss.clients.forEach((client) => {
    if (client.roomId == msg.roomId) {
      users.push(client.username);
      roomOnline++;
    }
  });

  roomOnline += game.bots;

  // отправка информации на клиентов в комнате
  for (const client of aWss.clients) {
    if (client.roomId == msg.roomId) {
      msg.online = roomOnline;
      msg.users = users;
      msg.startedAt = game.startedAt;
      client.send(JSON.stringify(msg));
    }
  }

  // отправка всем об онлайне в каждой игре
  let rooms = await roomsFunctions.getAllRoomsOnline(aWss);
  roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: rooms });
};

const isTimerStarted = async (msg) => {
  // get room online
  let gameState = await LotoGame.findOne({
    where: { gameLevel: msg.roomId },
  });

  if (gameState.isWaiting && gameState.startedAt != null) {
    return true;
  } else return false;
};
const startRoomTimer = async (msg) => {
  // get room online
  let roomOnline = 0;
  let users = [];
  aWss.clients.forEach((client) => {
    if (client.roomId == msg.roomId) {
      users.push(client.username);
      roomOnline++;
    }
  });

  let gameState = await LotoGame.findOne({
    where: { gameLevel: msg.roomId },
  });

  if (roomOnline == 1 && gameState.isWaiting == false) {
    await LotoGame.update(
      { startedAt: new Date(), isStarted: false, isWaiting: true },
      {
        where: { gameLevel: msg.roomId },
      }
    );

    // await getAllRoomsStartTimers();
    return new Date();
  } else return false;
};

function disconnectexistingClient(counter, client) {
  if (counter > 1) {
    client.close();
  }
}

// // web sockets для подключения к общей информации о комнатах на начальной странице

const broadcastMenu = async (ws, msg) => {
  for (const client of aWss.clients) {
    client.send(JSON.stringify(msg));
  }
};
