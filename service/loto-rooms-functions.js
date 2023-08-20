const bcrypt = require("bcrypt");
const uuid = require("uuid");
const mailService = require("./mail-service");
const tokenService = require("./token-service");
const UserDto = require("../dtos/user-dto");
const ApiError = require("../exceptions/api-error");
const {
  User,
  Role,
  Rate,
  LotoGame,
  LotoSetting,
  LotoCard,
} = require("../models/db-models");

class RoomsService {
  async getAllRoomsOnline(aWss) {
    const games = await LotoGame.findAll();
    let rooms = {
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    };
    for (let room = 1; room <= 5; room++) {
      const game = games[room - 1];
      const roomId = room;
      // get every room online
      let roomOnline = 0;
      aWss.clients.forEach((client) => {
        if (client.roomId == roomId) {
          roomOnline++;
        }
      });

      //   const game = await LotoGame.findOne({ where: { gameLevel: roomId } });
      roomOnline += game.bots;

      rooms[`room${roomId}`] = roomOnline;
    }
    return rooms;
  }

  async checkAllJackpots() {
    let roomsBet = {
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    };
    // получение информации о всех играх
    let gameInfo = await LotoGame.findAll();
    // получение всех билетов в базе
    let cardsInRoom = await LotoCard.findAll({});
    // console.log(cardsInRoom);

    let roomsCards = {
      room1: [],
      room2: [],
      room3: [],
      room4: [],
      room5: [],
    };

    cardsInRoom.forEach((card) => {
      if (card.gameLevel == 1) {
        roomsCards.room1.push(card);
      } else if (card.gameLevel == 2) {
        roomsCards.room2.push(card);
      } else if (card.gameLevel == 3) {
        roomsCards.room3.push(card);
      } else if (card.gameLevel == 4) {
        roomsCards.room4.push(card);
      } else if (card.gameLevel == 5) {
        roomsCards.room5.push(card);
      }
    });

    // отправка даных
    for (let room = 1; room <= 5; room++) {
      let thisRoomInfo = gameInfo[room - 1];
      const roomId = room;
      const cards = roomsCards[`room${room}`];

      let roomComminsionInfo = this.getRoomCommisionInfo(roomId);

      let botsTicketsNum = 0;
      let botsTicketsArr = JSON.parse(thisRoomInfo.botsTickets);

      botsTicketsArr.forEach((ticket) => {
        botsTicketsNum += Number(ticket);
      });

      let roomJackpot =
        (cards.length + botsTicketsNum) * roomComminsionInfo.jackpotPart;

      roomsBet[`room${roomId}`] = roomJackpot;
    }

    return roomsBet;
  }

  async checkJackpot(ws, aWss, msg) {
    let roomComminsionInfo = this.getRoomCommisionInfo(msg.roomId);

    let cardsInRoom = await LotoCard.findAll({
      where: { gameLevel: msg.roomId },
    });
    let gameInfo = await LotoGame.findOne({ where: { gameLevel: msg.roomId } });
    let botsTicketsNum = 0;
    let botsTicketsArr = JSON.parse(gameInfo.botsTickets);

    botsTicketsArr.forEach((ticket) => {
      botsTicketsNum += Number(ticket);
    });
    for (const client of aWss.clients) {
      if (client.roomId == msg.roomId) {
        const message = {
          method: "updateJackpot",
          jackpot:
            (cardsInRoom.length + botsTicketsNum) *
            roomComminsionInfo.jackpotPart,
        };
        client.send(JSON.stringify(message));
      }
    }
  }

  async sendAll(aWss, methodStr, body) {
    let message = body;
    message.method = methodStr;

    for (const client of aWss.clients) {
      client.send(JSON.stringify(message));
    }
  }

  async sendWithFilter(aWss, ws, methodStr, body) {}

  async getAllPrevBets() {
    let roomsPrevBank = {
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    };
    // получение информации о всех играх
    let gameInfo = await LotoGame.findAll();

    // отправка даных
    for (let room = 1; room <= 5; room++) {
      let thisRoomInfo = gameInfo[room - 1];
      let roomPrevBank = thisRoomInfo.prevBank;
      roomsPrevBank[`room${room}`] = roomPrevBank;
    }

    return roomsPrevBank;
  }

  async checkAllBets() {
    let roomsBet = {
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    };
    // получение информации о всех играх
    let gameInfo = await LotoGame.findAll();
    // получение всех билетов в базе
    let cardsInRoom = await LotoCard.findAll({});
    // console.log(cardsInRoom);

    let roomsCards = {
      room1: [],
      room2: [],
      room3: [],
      room4: [],
      room5: [],
    };

    cardsInRoom.forEach((card) => {
      if (card.gameLevel == 1) {
        roomsCards.room1.push(card);
      } else if (card.gameLevel == 2) {
        roomsCards.room2.push(card);
      } else if (card.gameLevel == 3) {
        roomsCards.room3.push(card);
      } else if (card.gameLevel == 4) {
        roomsCards.room4.push(card);
      } else if (card.gameLevel == 5) {
        roomsCards.room5.push(card);
      }
    });

    // let roomsCards = {
    //     room1: [card, card, card],
    //     room2: [card, card, card],
    //     room3: [card, card, card],
    //   };

    // отправка даных
    for (let room = 1; room <= 5; room++) {
      let thisRoomInfo = gameInfo[room - 1];
      const roomId = room;
      const cards = roomsCards[`room${room}`];

      let roomComminsionInfo = this.getRoomCommisionInfo(roomId);

      let botsTicketsNum = 0;
      let botsTicketsArr = JSON.parse(thisRoomInfo.botsTickets);

      botsTicketsArr.forEach((ticket) => {
        botsTicketsNum += Number(ticket);
      });

      let roomBet = (cards.length + botsTicketsNum) * roomComminsionInfo.bet;

      roomsBet[`room${roomId}`] = roomBet;
    }

    return roomsBet;
  }

  async getAllRoomsStartTimers() {
    const roomTimers = {
      room1: null,
      room2: null,
      room3: null,
      room4: null,
      room5: null,
    };

    const rooms = await LotoGame.findAll();
    for (let gameLevel = 1; gameLevel <= 5; gameLevel++) {
      const room = rooms.find((room) => room.gameLevel == gameLevel);
      roomTimers[`room${gameLevel}`] = room.startedAt;
    }

    return roomTimers;
  }

  async getAllRoomsFinishTimers() {
    const roomTimers = {
      room1: null,
      room2: null,
      room3: null,
      room4: null,
      room5: null,
    };

    const rooms = await LotoGame.findAll();
    for (let gameLevel = 1; gameLevel <= 5; gameLevel++) {
      const room = rooms.find((room) => room.gameLevel == gameLevel);
      roomTimers[`room${gameLevel}`] = room.finishesAt;
    }

    return roomTimers;
  }

  getRoomCommisionInfo(roomId) {
    let commission,
      jackpotAnimationSum,
      bet,
      jackpotPart,
      fullBet = 0,
      tokens;
    switch (roomId) {
      case 1:
        fullBet = 0.2;
        commission = 0.03;
        jackpotPart = 0.01;
        bet = 0.16;
        jackpotAnimationSum = 200;
        tokens = 2;
        break;
      case 2:
        fullBet = 0.5;
        commission = 0.075;
        jackpotPart = 0.025;
        bet = 0.4;
        jackpotAnimationSum = 200;
        tokens = 5;
        break;
      case 3:
        fullBet = 1;
        commission = 0.15;
        jackpotPart = 0.05;
        bet = 0.8;
        jackpotAnimationSum = 250;
        tokens = 10;
        break;
      case 4:
        fullBet = 5;
        commission = 0.75;
        jackpotPart = 0.25;
        bet = 4;
        jackpotAnimationSum = 300;
        tokens = 50;
        break;
      case 5:
        fullBet = 10;
        commission = 1.5;
        jackpotPart = 0.5;
        bet = 8;
        jackpotAnimationSum = 350;
        tokens = 100;
        break;
    }
    return {
      commission,
      jackpotPart,
      bet,
      jackpotAnimationSum,
      fullBet,
      tokens,
    };
  }

  generateBotTicketCasks() {
    let casks = [];
    for (let i = 0; i < 15; i++) {
      let randomNum = Math.floor(Math.random() * 90) + 1;
      while (casks.includes(randomNum)) {
        randomNum = Math.floor(Math.random() * 90) + 1;
      }
      casks.push(randomNum);
    }
    return casks;
  }
}

module.exports = new RoomsService();
