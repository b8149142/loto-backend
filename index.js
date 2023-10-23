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
  User,
  CurrencyRate,
  DominoGame,
  DominoGamePlayer,
} = require("./models/db-models");
const AdminLotoService = require("./service/loto-admin-service");
const gameService = require("./service/game-service");
const lotoAdminService = require("./service/loto-admin-service");
const roomsFunctions = require("./service/loto-rooms-functions");
const dominoNavService = require("./service/navigation-domino-service");
const dominoWsNavService = require("./service/domino-ws-navigation");

const PORT = process.env.PORT || 5001;

app.use(express.json());
app.use(cookieParser());
// app.use(
//   cors({
//     credentials: true,
//     origin: process.env.CLIENT_URL,
//   })
// );
app.use(
  cors({
    credentials: false,
    origin: "*",
  })
);
app.use("/api", router);
app.use(errorMiddleware);

const getCurrency = async () => {
  const currency = await axios.get(
    "https://api.apilayer.com/currency_data/live?base=USD&symbols=EUR,GBP",
    {
      headers: {
        apikey: "ck1iyDdQa5oY4FesB3GSSNHnyTfuV6yy",
      },
    }
  );

  await CurrencyRate.update(
    {
      rate: currency.data.quotes.USDAZN,
    },
    { where: { id: 1 } }
  );
};

const start = async () => {
  try {
    const sequelize = require("./db");
    await sequelize.authenticate();
    await sequelize.sync();

    const currencyCheck = await CurrencyRate.findOne({ where: { id: 1 } });

    if (!currencyCheck) {
      await CurrencyRate.create({ id: 1, rate: 1.705 });
    }

    // await getCurrency();
    // setTimeout(async () => {
    // await getCurrency();
    // }, 1000 * 60 * 60 * 24);

    await LotoGame.update(
      {
        bots: 0,
        isStarted: false,
        isWaiting: false,
        startedAt: null,
        finishesAt: null,
        prevBank: 0,
        botsTickets: JSON.stringify([]),
      },
      { where: { gameLevel: [1, 2, 3, 4, 5] } }
    );
    await LotoCard.destroy({ where: {} });

    // await UserGame.drop()
    //   .then(() => {
    //     console.log('Table deleted successfully.');
    //   })
    //   .catch((err) => {
    //     console.error('Error deleting table:', err);
    //   });

    const botStats = await BotStats.findAll();
    if (botStats.length != 1) {
      await BotStats.destroy({ where: {} });
      await BotStats.create();
    }

    const lotoGames = await LotoGame.findAll();
    if (lotoGames.length != 5) {
      await LotoGame.destroy({ where: {} });
      for (let i = 1; i <= 5; i++) {
        await LotoGame.create({ gameLevel: i });
      }
    }

    // await DominoGame.destroy({ where: {} });
    await DominoGamePlayer.destroy({ where: {} });

    const dominoGames = await DominoGame.findAll();
    if (dominoGames.length !== 60) {
      await DominoGame.destroy({ where: {} });

      for (let gameMode = 1; gameMode <= 2; gameMode++) {
        for (let playerMode = 2; playerMode <= 4; playerMode += 2) {
          for (let roomId = 1; roomId <= 5; roomId++) {
            for (let tableId = 1; tableId <= 3; tableId++) {
              await DominoGame.create({
                startedAt: null,
                isStarted: false,
                roomId: roomId,
                tableId: tableId,
                playerMode: playerMode,
                gameMode: gameMode == 1 ? "CLASSIC" : "TELEPHONE",
              });
            }
          }
        }
      }
    }

    const bots = await Bot.findAll();
    if (bots.length < 30) {
      for (let i = 0; i < 30; i++) {
        const randomUserdata = await axios.get(
          "https://random-data-api.com/api/v2/users"
        );
        const username = randomUserdata.data.first_name;
        await Bot.create({ username, lotoTokens: 10 });
      }
    }

    const lotoSettings = await LotoSetting.findAll();
    if (lotoSettings.length != 5) {
      await LotoSetting.destroy({ where: {} });
      for (let i = 1; i <= 5; i++) {
        await LotoSetting.create({
          gameLevel: i,
          allowBots: true,
          maxBots: 4,
          maxTickets: 6,
          winChance: 20,
          jackpotWinChance: 20,
          minJackpotSum: 200,
        });
      }
    }

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
        console.log(msg);
        broadcastMenu(ws, msg);
        // отправка игроку об онлайне в меню
        let rooms = await roomsFunctions.getAllRoomsOnline(aWss);
        let roomsMsg = { rooms: rooms };
        roomsMsg.method = "allRoomsOnline";
        ws.send(JSON.stringify(roomsMsg));

        // roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: rooms });

        // отправка пользователю о джекпотах в меню
        let roomsJackpots = await roomsFunctions.checkAllJackpots();

        let roomsJackpotsMsg = { jackpots: roomsJackpots };
        roomsJackpotsMsg.method = "updateAllRoomsJackpot";
        ws.send(JSON.stringify(roomsJackpotsMsg));

        // отправка пользователю о ставке в меню
        let roomsBet = await roomsFunctions.checkAllBets();
        let roomsBetMsg = { bank: roomsBet };
        roomsBetMsg.method = "updateAllRoomsBank";
        ws.send(JSON.stringify(roomsBetMsg));

        // отправка пользователю о начале игры в меню
        let roomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
        let roomsStartTimerMsg = { timers: roomsStartTimer };
        roomsStartTimerMsg.method = "allRoomsStartTimers";
        ws.send(JSON.stringify(roomsStartTimerMsg));

        // отправка пользователю о конце игры в меню
        let roomsFinishTimer = await roomsFunctions.getAllRoomsFinishTimers();

        let roomsFinishTimerMsg = { timers: roomsFinishTimer };
        roomsFinishTimerMsg.method = "allRoomsFinishTimers";
        ws.send(JSON.stringify(roomsFinishTimerMsg));

        // отправка пользователю о последнем банке в играх
        let prevBank = await roomsFunctions.getAllPrevBets();

        let prevBankMsg = { prevBank: prevBank };
        prevBankMsg.method = "updateAllRoomsPrevBank";
        ws.send(JSON.stringify(prevBankMsg));

        break;
      case "getAllInfo":
        // отправка всем об онлайне в меню

        let allrooms = await roomsFunctions.getAllRoomsOnline(aWss);
        let AllroomsMsg = { rooms: allrooms };
        AllroomsMsg.method = "allRoomsOnline";
        ws.send(JSON.stringify(AllroomsMsg));
        // отправка всем о джекпотах в меню
        let allRoomsJackpots = await roomsFunctions.checkAllJackpots();
        let allRoomsJackpotsMsg = { jackpots: allRoomsJackpots };
        allRoomsJackpotsMsg.method = "updateAllRoomsJackpot";
        ws.send(JSON.stringify(allRoomsJackpotsMsg));

        // отправка всем о ставке в меню
        let allRoomsBet = await roomsFunctions.checkAllBets();
        let allRoomsBetMsg = { bank: allRoomsBet };
        allRoomsBetMsg.method = "updateAllRoomsBank";
        ws.send(JSON.stringify(allRoomsBetMsg));
        // roomsFunctions.sendAll(aWss, "updateAllRoomsBank", {
        //   bank: allRoomsBet,
        // });

        // отправка всем о начале игры в меню
        let allRoomsStartTimer = await roomsFunctions.getAllRoomsStartTimers();
        let allRoomsStartTimerMsg = { timers: allRoomsStartTimer };
        allRoomsStartTimerMsg.method = "allRoomsStartTimers";
        ws.send(JSON.stringify(allRoomsStartTimerMsg));
        // roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
        //   timers: allRoomsStartTimer,
        // });

        // отправка всем о конце игры в меню
        let allRoomsFinishTimer =
          await roomsFunctions.getAllRoomsFinishTimers();
        let allRoomsFinishTimerMsg = { timers: allRoomsFinishTimer };
        allRoomsFinishTimerMsg.method = "allRoomsFinishTimers";
        ws.send(JSON.stringify(allRoomsFinishTimerMsg));

        // roomsFunctions.sendAll(aWss, "allRoomsFinishTimers", {
        //   timers: allRoomsFinishTimer,
        // });

        break;

      case "connectGame":
        ws.roomId = msg.roomId;
        ws.userId = msg.userId;
        ws.username = msg.username;

        await gameConnectionHandler(ws, msg);
        await gameService.startRoomLobby(ws, aWss, msg);
        await gameService.checkBet(ws, aWss, msg);
        await roomsFunctions.checkJackpot(ws, aWss, msg);

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
      case "rejectGameBet":
        console.log(msg);
        const game = await LotoGame.findOne({
          where: { gameLevel: +msg.roomId },
        });
        if (game.startedAt != null) {
          msg.error = 1;
          ws.send(JSON.stringify(msg));
          return;
        }

        try {
          const userId = msg.userId;
          const { roomId, bet } = msg;

          const userCards = await LotoCard.findAll({
            where: { userId, gameLevel: +roomId },
          });
          await LotoCard.destroy({ where: { userId, gameLevel: +roomId } });

          const user = await User.findOne({ where: { id: userId } });
          await User.update(
            { balance: user.balance + Number(bet) * userCards.length },
            { where: { id: userId } }
          );
          // JSON.parse(newBotsTickets.length) * roomComminsionInfo.jackpotPart,
          // обновление джекпота обратно
          const roomComminsionInfo = roomsFunctions.getRoomCommisionInfo(
            +msg.roomId
          );

          let botsTickets = 0;
          JSON.parse(game.botsTickets).forEach((botTickets) => {
            botsTickets += +botTickets;
          });

          let newJackpotSum =
            (botsTickets + userCards.length) * roomComminsionInfo.jackpotPart;

          await roomsFunctions.updateJackpot(msg.roomId, -1 * newJackpotSum);

          let closeMsg = { reason: "rejectGameBet", page: "mainLotoPage" };
          msg.newBalance = user.balance + Number(bet) * userCards.length;
          msg.error = 0;
          ws.send(JSON.stringify(msg));
          ws.roomId = null;
          ws.close(1000, JSON.stringify(closeMsg));

          setTimeout(async () => {
            // проверка сколько осталось людей в комнате и отключение ботов
            let roomPeopleOnline = await checkPeopleOnline(msg.roomId);
            if (roomPeopleOnline <= 1) {
              setTimeout(async () => {
                await LotoGame.update(
                  { bots: 0, botsTickets: JSON.stringify([]) },
                  { where: { gameLevel: +roomId } }
                );

                let allRoomsOnline = await roomsFunctions.getAllRoomsOnline(
                  aWss
                );

                roomsFunctions.sendAll(aWss, "allRoomsOnline", {
                  rooms: allRoomsOnline,
                  where: "deleteBots",
                });

                let allRoomsBet = await roomsFunctions.checkAllBets();
                roomsFunctions.sendAll(aWss, "updateAllRoomsBank", {
                  bank: allRoomsBet,
                });
              }, Math.round(Math.random * 1000) + 500);
            }

            // отправка всем об онлайне в меню
            let allRoomsOnline = await roomsFunctions.getAllRoomsOnline(aWss);
            roomsFunctions.sendAll(aWss, "allRoomsOnline", {
              rooms: allRoomsOnline,
              where: "rejectBet",
            });

            // отправка всем о ставке в меню
            let allRoomsBet = await roomsFunctions.checkAllBets();
            roomsFunctions.sendAll(aWss, "updateAllRoomsBank", {
              bank: allRoomsBet,
            });
            // отправка всем о джекпотах в меню
            let allRoomsJackpots = await roomsFunctions.checkAllJackpots();
            roomsFunctions.sendAll(aWss, "updateAllRoomsJackpot", {
              jackpots: allRoomsJackpots,
            });

            // отправка всем о начале игры в меню
            let allRoomsStartTimer =
              await roomsFunctions.getAllRoomsStartTimers();
            roomsFunctions.sendAll(aWss, "allRoomsStartTimers", {
              timers: allRoomsStartTimer,
            });

            // отправка всем о конце игры в меню
            let allRoomsFinishTimer =
              await roomsFunctions.getAllRoomsFinishTimers();
            roomsFunctions.sendAll(aWss, "allRoomsFinishTimers", {
              timers: allRoomsFinishTimer,
            });
          }, 50);
        } catch (error) {
          msg.error = 1;
          ws.send(JSON.stringify(msg));
          // ws.close(1000, JSON.stringify(closeMsg));
        }

        break;
      case "cancelCard":
        const cardId = msg.cardId;
        await LotoCard.update({ isActive: false }, { where: { id: cardId } });

      // ============ DOMINO ============ //
    }
  });

  dominoWsNavService.addDominoWsListeners(ws, aWss);

  ws.on("close", async (status, msg) => {
    // console.log(ws);
    if (ws.dominoRoomId && ws.dominoRoomId != null) {
      dominoNavService.getAllDominoInfo(null, aWss);
    }

    // === //

    if (status > 1000) {
      // обновить онлайн во всех комнатах на клиенте
      let roomsOnline = await roomsFunctions.getAllRoomsOnline(aWss);
      roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: roomsOnline });
      // отправка всем о ставке в меню
      let roomsBet = await roomsFunctions.checkAllBets();
      roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });
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
    case "disconnectGame":
      ws.roomId = msg.roomId;
      await gameService.checkBet(ws, aWss, msg);
      await roomsFunctions.checkJackpot(ws, aWss, msg);
      broadcastGame(ws, msg);
      break;
  }
};

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
    }
    return rooms;
  }
};

const gameConnectionHandler = async (ws, msg) => {
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

  // получение информации об игре
  const game = await LotoGame.findOne({
    where: { gameLevel: msg.roomId },
  });
  let roomComminsionInfo = roomsFunctions.getRoomCommisionInfo(msg.roomId);

  let isJackpotPlaying = false;
  if (game.jackpot > roomComminsionInfo.jackpotAnimationSum) {
    isJackpotPlaying = true;
  }

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

  let bank = await roomsFunctions.checkRoomBet(msg.roomId);

  // отправка информации на клиентов в комнате
  for (const client of aWss.clients) {
    if (client.roomId == msg.roomId) {
      msg.online = roomOnline;
      msg.users = users;
      msg.startedAt = game.startedAt;
      msg.isJackpotPlaying = isJackpotPlaying;
      msg.bank = bank;
      client.send(JSON.stringify(msg));
    }
  }

  // отправка всем об онлайне в каждой игре
  let rooms = await roomsFunctions.getAllRoomsOnline(aWss);
  roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: rooms });
};

function disconnectexistingClient(array) {
  if (array.length > 1) {
    array.pop();
    array.forEach((userConnection) => {
      let disconnectMsg = {
        reason: "connectionIsAlreadyExist",
        page: "mainLotoPage",
      };
      userConnection.close(1000, JSON.stringify(disconnectMsg));
    });
  }
}

// web sockets для подключения к общей информации о комнатах на начальной странице

const broadcastMenu = async (ws, msg) => {
  ws.loginUsername = msg.username;
  ws.clientId = msg.clientId;

  // проверка сущестуют ли другие сесии с этого аккаунта
  for (const client of aWss.clients) {
    if (
      client.loginUsername == msg.username &&
      client.clientId != msg.clientId
    ) {
      let logoutMessage = {
        method: "logoutUser",
      };
      client.send(JSON.stringify(logoutMessage));
    }
  }

  for (const client of aWss.clients) {
    client.send(JSON.stringify(msg));
  }
};

// ============ DOMINO ============ //

// function checkIfPlayerAlreadyInTable(msg) {
//   let isPlayerAlreadyInTable = false;
//   aWss.clients.forEach((client) => {
//     if (
//       client.dominoRoomId == msg.dominoRoomId &&
//       client.table == msg.table &&
//       client.userId == msg.userId
//     ) {
//       console.log(client.dominoRoomId, msg.dominoRoomId);
//       console.log(client.userId, msg.userId);
//       isPlayerAlreadyInTable = true;
//     }
//   });
//   return isPlayerAlreadyInTable;
// }
