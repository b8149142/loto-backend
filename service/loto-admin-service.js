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
const roomsFunctions = require("./loto-rooms-functions");

class AdminLotoService {
  async createBot(ws, aWss, msg) {
    const roomComminsionInfo = roomsFunctions.getRoomCommisionInfo(msg.roomId);
    const setting = await LotoSetting.findOne({
      where: { gameLevel: msg.roomId },
    });
    if (setting.allowBots == false) return;

    setTimeout(async () => {
      const prev = await LotoGame.findOne({ where: { gameLevel: msg.roomId } });
      if (prev.isStarted == true) {
        return;
      }
      if (prev.bots < setting.maxBots) {
        // добавляем бота и карточки бота в базу карточек ботов
        const number = Math.floor(
          Math.random() * (setting.maxTickets - 0.01) + 1
        );

        let newBotsTickets = JSON.stringify([
          ...JSON.parse(prev.botsTickets || "[]"),
          number,
        ]);
        let bots = (+prev.bots || 0) + 1;

        await LotoGame.update(
          {
            bots: bots,
            botsTickets: newBotsTickets,
          },
          { where: { gameLevel: msg.roomId } }
        );
        // обновляем банк и отправляем на клиент
        const gameService = require("./game-service");
        // проверка есть ли 3 человека в комнате
        await gameService.startRoomLobby(ws, aWss, msg);

        // обновляем онлайн и отправляем на клиентов

        let roomOnline = 0;
        aWss.clients.forEach((client) => {
          if (client.roomId == msg.roomId) {
            roomOnline++;
          }
        });

        roomOnline += prev.bots + 1;

        for (const client of aWss.clients) {
          if (client.roomId == msg.roomId) {
            msg.method = "updateOnline";
            msg.online = roomOnline;
            client.send(JSON.stringify(msg));
          }
        }

        // отправка всем об онлайне в меню
        let rooms = await roomsFunctions.getAllRoomsOnline(aWss);
        roomsFunctions.sendAll(aWss, "allRoomsOnline", { rooms: rooms });

        // отправка всем в комнате о ставке
        await gameService.checkBet(ws, aWss, msg);
        await roomsFunctions.checkJackpot(ws, aWss, msg);

        // отправка всем о джекпотах в меню
        await roomsFunctions.updateJackpot(
          msg.roomId,
          JSON.parse(newBotsTickets.length) * roomComminsionInfo.jackpotPart,
          prev
        );
        let roomsJackpots = await roomsFunctions.checkAllJackpots();
        roomsFunctions.sendAll(aWss, "updateAllRoomsJackpot", {
          jackpots: roomsJackpots,
        });

        // отправка всем о джекпоте в игре
        await roomsFunctions.checkJackpot(ws, aWss, msg);

        // отправка всем о ставке в меню
        let roomsBet = await roomsFunctions.checkAllBets();
        roomsFunctions.sendAll(aWss, "updateAllRoomsBank", { bank: roomsBet });
      }
    }, Math.round(Math.random() * 5000));
  }

  // async deleteBot(ws, aWss, msg) {
  //   setTimeout(async () => {
  //     const prev = await LotoGame.findOne({ where: { gameLevel: msg.roomId } });
  //     await LotoGame.update(
  //       { bots: (+prev.bots || 0) - 1, botsTickets: JSON.stringify(JSON.parse()) },
  //       { where: { gameLevel: msg.roomId } }
  //     );
  //   }, Math.round(Math.random() * 1000 + 500));
  // }

  async deleteBots(roomOnline, roomId = null) {
    if (roomId) {
      await LotoGame.update(
        {
          bots: 0,
          botsTickets: "[]",
        },
        { where: { gameLevel: roomId } }
      );
    } else {
      for (let room = 1; room <= 5; room++) {
        const roomId = room;
        if (roomOnline[`room${roomId}`] == 0) {
          await LotoGame.update(
            {
              bots: 0,
              botsTickets: "[]",
            },
            { where: { gameLevel: roomId } }
          );
        }
      }
    }
  }
}

module.exports = new AdminLotoService();
