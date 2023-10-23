const {
  Loto,
  User,
  LotoCard,
  LotoGame,
  LotoSetting,
  Stats,
  BotStats,
  UserGame,
  Bot,
  PlayedGame,
  DominoGame,
  DominoGamePlayer,
} = require("../models/db-models");
const lotoAdminService = require("./loto-admin-service");
const roomsFunctions = require("./loto-rooms-functions");
const dominoGameService = require("./game-domino-service");
const dominoNavService = require("./navigation-domino-service");
const axios = require("axios");
const { literal } = require("sequelize");

let activeTimeouts = [];

function pushTimeout(timeoutObject) {
  activeTimeouts.push(timeoutObject);
}

function removeTimeout(roomId, tableId, playerMode, gameMode) {
  let timeoutsToRemove = activeTimeouts.filter((timeoutObject) => {
    return (
      timeoutObject.roomId === roomId &&
      timeoutObject.tableId === tableId &&
      timeoutObject.playerMode === playerMode &&
      timeoutObject.gameMode === gameMode
    );
  });

  for (const timeoutObject of timeoutsToRemove) {
    clearTimeout(timeoutObject.timeout);
    activeTimeouts.splice(activeTimeouts.indexOf(timeoutObject), 1);
  }
}

class dominoWsNavService {
  async addDominoWsListeners(ws, aWss) {
    ws.on("message", async (msg) => {
      msg = JSON.parse(msg);

      console.log(msg);
      console.log(msg?.gameMode);

      switch (msg.method) {
        case "connectDomino":
          console.log(msg);
          const dominoGame = await DominoGame.findOne({
            where: {
              roomId: msg.dominoRoomId,
              tableId: msg.tableId,
              playerMode: msg.playerMode,
              gameMode: msg.gameMode,
            },
            include: DominoGamePlayer,
          });

          // console.log(dominoGame);

          const betInfo = dominoGameService.getDominoRoomBetInfo(
            msg.dominoRoomId
          );

          const user = await User.findOne({
            where: {
              id: msg.userId,
            },
          });

          if (user.balance < betInfo.bet) {
            ws.send(
              JSON.stringify({
                method: "notEnoughBalance",
              })
            );
            return;
          }

          // check if game is started and user is not in game
          if (
            dominoGame.startedAt != null &&
            !dominoGame.dominoGamePlayers.find(
              (player) => player.userId === msg.userId
            )
          ) {
            // ws.send(
            //   JSON.stringify({
            //     method: "notEnoughBalance",
            //   })
            // );
            return;
          }

          await dominoNavService.dominoRoomConnectionHandler(
            ws,
            aWss,
            msg,
            this.startTurn
          );

          // check if user is in game and send him all info
          if (
            dominoGame.dominoGamePlayers.find(
              (player) => player.userId === msg.userId
            )
          ) {
            if (dominoGame.isFinished == true) {
              let message = {
                method: "reconnectEndedDominoGame",
              };
              roomsFunctions.sendToClientsInTable(
                aWss,
                msg.dominoRoomId,
                msg.tableId,
                msg.playerMode,
                msg.gameMode,
                message
              );

              return;
            }
            await dominoGameService.sendAllTableInfo(
              ws,
              msg.dominoRoomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
          }

          break;

        case "getAllDominoInfo":
          await dominoNavService.getAllDominoInfo(ws, aWss);
          break;

        case "leaveDominoTable":
          await dominoNavService.removeUserFromTable(aWss, msg);
          break;

        case "playDominoTurn":
          console.log(msg);
          const isPlaced = await dominoGameService.placeTile(ws, aWss, msg);
          if (isPlaced) {
            await dominoGameService.sendNewScene(
              ws,
              aWss,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
            await this.startTurn(
              aWss,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode,
              null,
              null,
              true
            );
          }
          break;

        case "getMarketTile":
          await dominoGameService.giveMarketTile(
            ws,
            aWss,
            msg.userId,
            this.startTurn
          );
          break;

        case "checkMarket":
          const checkDominoGame = await DominoGame.findOne({
            where: {
              roomId: msg.roomId,
              tableId: msg.tableId,
              playerMode: msg.playerMode,
              gameMode: msg.gameMode,
            },
            include: DominoGamePlayer,
          });

          await dominoGameService.checkAvailableTurn(
            aWss,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            checkDominoGame.turn,
            checkDominoGame
          );
          break;

        case "sendEmoji":
          dominoGameService.sendEmoji(
            aWss,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.emojiId,
            msg.userId
          );
          break;

        case "sendPhrase":
          dominoGameService.sendPhrase(
            aWss,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.phraseId,
            msg.userId
          );
          break;
      }
    });
  }

  startTurn = async (
    aWss,
    roomId,
    tableId,
    players,
    gameMode,
    currentTurn = null,
    turnTime = null,
    handleTurn = null,
    skipedTurn = false
  ) => {
    removeTimeout(roomId, tableId, players, gameMode);

    let winGame = await dominoGameService.checkWin(
      aWss,
      roomId,
      tableId,
      players,
      gameMode,
      this.startTurn
    );
    if (winGame) {
      return;
    }

    // когда начало игры
    if (currentTurn) {
      await DominoGame.update(
        {
          turn: currentTurn,
        },
        {
          where: {
            roomId,
            tableId,
            playerMode: players,
            gameMode,
          },
        }
      );
    } else if (!currentTurn && handleTurn) {
      const date = await axios.get(
        "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      turnTime = new Date(date.data.dateTime).getTime();

      const dominoGame = await DominoGame.findOne({
        where: {
          roomId,
          tableId,
          playerMode: players,
          gameMode,
        },
        include: DominoGamePlayer,
      });

      let turn = +dominoGame.turn;
      const turnQueue = JSON.parse(dominoGame.turnQueue);
      let nexTurn = +turnQueue[(turnQueue.indexOf(turn) + 1) % players];

      await dominoGame.update({
        turn: nexTurn,
        turnTime: turnTime,
      });

      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        players,
        gameMode,
        {
          method: "newDominoTurn",
          currentTurn: nexTurn,
          turnTime: turnTime,
          pastTurn: turn,
          skipedTurn: { skipedTurn: skipedTurn, playerId: turn },
          scene: JSON.parse(dominoGame.scene),
        }
      );

      dominoGameService.checkAvailableTurn(
        aWss,
        roomId,
        tableId,
        players,
        gameMode,
        nexTurn,
        dominoGame,
        this.startTurn
      );
    }

    // создаем таймаут
    let timeout = setTimeout(async () => {
      const date = await axios.get(
        "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      turnTime = new Date(date.data.dateTime).getTime();

      let dominoGame = await DominoGame.findOne({
        where: {
          roomId,
          tableId,
          playerMode: players,
          gameMode,
        },
        include: DominoGamePlayer,
      });

      let turn = +dominoGame.turn;
      const turnQueue = JSON.parse(dominoGame.turnQueue);
      let nexTurn = +turnQueue[(turnQueue.indexOf(turn) + 1) % players];
      // drop lowest tile that can be placed if player didn't place tile in time
      await dominoGameService.placeTileOnSkippedTurn(
        aWss,
        dominoGame,
        turn,
        gameMode
      );

      await dominoGame.update({
        turn: nexTurn,
        turnTime: turnTime,
      });
      dominoGame = await DominoGame.findOne({
        where: {
          roomId,
          tableId,
          playerMode: players,
          gameMode,
        },
        include: DominoGamePlayer,
      });

      skipedTurn = true;
      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        players,
        gameMode,
        {
          method: "newDominoTurn",
          currentTurn: nexTurn,
          turnTime: turnTime,
          pastTurn: turn,
          skipedTurn: { skipedTurn: skipedTurn, playerId: turn },
          scene: JSON.parse(dominoGame.scene),
        }
      );

      dominoGameService.checkAvailableTurn(
        aWss,
        roomId,
        tableId,
        players,
        gameMode,
        nexTurn,
        dominoGame,
        this.startTurn
      );

      await this.startTurn(aWss, roomId, tableId, players, gameMode);
    }, 26000);

    // записываем таймаут
    let timeoutObject = {
      roomId,
      tableId,
      playerMode: players,
      gameMode,
      timeout,
    };
    pushTimeout(timeoutObject);
  };
}

module.exports = new dominoWsNavService();
