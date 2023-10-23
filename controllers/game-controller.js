const ApiError = require("../exceptions/api-error");
const {
  Loto,
  User,
  LotoCard,
  LotoGame,
  DominoGame,
  DominoGamePlayer,
} = require("../models/db-models");
const gameService = require("../service/game-service");

const events = require("events");
const emitter = new events.EventEmitter();

let timeoutId = null;

class GameController {
  async start(req, res) {
    const roomId = req.body.roomId;
    const room = await Room.findOne({ where: { id: roomId } });
    await Game.create({ players: `[${req.user.id}]` });
  }

  async connectLotoRoom(req, res) {
    try {
      let { roomId } = req.params;
      let userId = req.user.id;

      let bet = 0;
      switch (roomId) {
        case "1":
          bet = 20;
          break;
        case "2":
          bet = 100;
          break;
        case "3":
          bet = 300;
          break;
        default:
          return res.status(400).json("Room does not exist");
      }

      // проверка или человек уже в игре

      let playerCandidate = await Loto.findOne({ where: { userId: userId } });
      if (playerCandidate) {
        await Loto.destroy({ where: { userId: userId } });
      }

      const lotoGame = await LotoGame.findOne({ where: { gameLevel: roomId } });

      const user = await User.findOne({ where: { id: userId } });
      await Loto.create({ gameLevel: roomId, userId: user.id });
      let usersInRoom = await Loto.findAll({ where: { gameLevel: roomId } });

      if (!lotoGame.isWaiting) {
        await LotoGame.update({ isWaiting: true }, { where: { id: roomId } });

        await LotoGame.update(
          { startedAt: new Date() },
          { where: { gameLevel: roomId } }
        );

        // ============================================================================================
        // ==========================================TIME=OUT==========================================
        // ============================================================================================

        timeoutId = setTimeout(async () => {
          const usersInGameRoom = await Loto.findAll({
            where: { gameLevel: roomId },
          });

          if (usersInGameRoom.length < 2) {
            // Handle case when there are not enough users in the room to start the game
            usersInGameRoom.forEach(async (user) => {
              await Loto.destroy({ where: { userId: user.userId } });
              await LotoCard.destroy({ where: { userId: user.userId } });
            });

            await LotoGame.update(
              { startedAt: null, isStarted: false },
              { where: { gameLevel: roomId } }
            );

            // emitter.removeListener(`loto-room-${roomId}`, function () {});
            // return res.status(400).json("Not enough players in the room to start the game");
            // Note: The above lines are commented out, you may want to add relevant handling logic.
          }

          // Check if the user has a ticket before starting the game
          const userTickets = await LotoCard.findAll({
            where: { userId: userId },
          });
          if (userTickets.length < 1) {
            // emitter.removeListener(`loto-room-${roomId}`, function () {});
            // return res.status(400).json("You don't have a ticket to participate in the game");
            // Note: The above lines are commented out, you may want to add relevant handling logic.
            return;
          }

          let lotoGameInfo = await LotoGame.findOne({
            where: { gameLevel: roomId },
          });

          let gameResponce = await gameService.startLotoGame(roomId);

          await LotoGame.update(
            { isStarted: true },
            { where: { gameLevel: roomId } }
          );

          const gameMessage = {
            information: {
              online: usersInGameRoom.length,
              bet,
              bank: bet * usersInGameRoom.length,
              startedAt: lotoGameInfo.startedAt,
            },
            gameStatus: true,
            queueFinished: false,
            game: {
              casks: gameResponce.casks,
              winnersIds: gameResponce.winnersIds,
              lastIndex: gameResponce.lastIndex,
            },
          };
          emitter.emit(`loto-room-${roomId}`, gameMessage);

          return;
        }, 31000);
        // set timeoutId
      }

      let lotoGameInfo = await LotoGame.findOne({
        where: { gameLevel: roomId },
      });
      const lobbyMessage = {
        information: {
          online: usersInRoom.length,
          bet,
          bank: bet * usersInRoom.length,
          startedAt: lotoGameInfo.startedAt,
        },
        queueFinished: false,
        gameStatus: lotoGameInfo.isStarted,
        game: {},
      };
      emitter.emit(`loto-room-${roomId}`, lobbyMessage);
      emitter.emit("online");

      // If the provided roomId is not valid
      // return res.status(400).json("Room does not exist");

      res.status(200).json(lobbyMessage);
    } catch (e) {
      console.log(e);
      // Handle any errors appropriately
    }
  }

  async isGameStarted(req, res) {
    try {
      const { roomId } = req.params;
      const lotoGame = await LotoGame.findOne({ where: { gameLevel: roomId } });
      if (lotoGame.isStarted) {
        return res.status(200).json(true);
      } else {
        return res.status(200).json(false);
      }
    } catch (e) {
      console.log(e);
    }
  }

  async isUserInGame(req, res) {
    try {
      const { roomId } = req.params;
      const userId = req.user.id;

      console.log(`room: ${roomId} - user: ${userId}`);

      const roomCards = await LotoCard.findAll({
        where: { gameLevel: roomId },
      });

      let isUserInGame = false;

      roomCards.forEach((roomCard) => {
        let userWithCardId = roomCard.userId;
        if (userWithCardId == userId) {
          isUserInGame = true;
        }
      });

      return res.status(200).json(isUserInGame);
    } catch (e) {
      console.log(e);
    }
  }

  async finishLotoWaiting(req, res) {
    try {
      let { roomId } = req.params;
      let userId = req.user.id;
      await LotoGame.update({ isWaiting: false }, { where: { id: roomId } });
    } catch (e) {
      console.log(e);
    }
  }

  async disconnectLotoRoom(req, res) {
    let { roomId } = req.params;
    let userId = req.user.id;

    let bet = 0;
    switch (roomId) {
      case "1":
        bet = 20;
        break;
      case "2":
        bet = 100;
        break;
      case "3":
        bet = 300;
        break;
    }

    const user = await User.findOne({ where: { id: userId } });
    // удалить игрока с базы
    await Loto.destroy({ where: { userId: user.id } });
    // удалить карточки с базы
    const cards = await LotoCard.findAll({ where: { userId: user.id } });
    cards.forEach(async (card) => {
      await LotoCard.destroy({ where: { id: card.id } });
    });
    const usersInRoom = await Loto.findAll({ where: { gameLevel: roomId } });

    const lotoGame = await LotoGame.findOne({
      where: { gameLevel: roomId },
    });

    // if (usersInRoom.length == 0) {
    //   clearTimeout(timeoutId);
    // }

    if (usersInRoom.length == 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
    // Отмена таймаута, если он был установлен

    const message = {
      information: {
        online: usersInRoom.length,
        bet,
        bank: bet * usersInRoom.length,
        startedAt: lotoGame.startedAt,
      },
      queueFinished: false,

      gameStatus: lotoGame.isStarted,
      game: {},
    };

    if (usersInRoom.length === 0) {
      await LotoGame.update(
        { startedAt: null, isStarted: false, isWaiting: false },
        {
          where: { gameLevel: roomId },
        }
      );
    }

    emitter.emit("online");
    emitter.emit(`loto-room-${roomId}`, message);

    if (roomId != 1 && roomId != 2 && roomId != 3) {
      return res.status(400).json("Room does not exist");
    }

    emitter.removeListener(`loto-room-${roomId}`, function () {});
    res.status(200).json("");
  }

  async clearAll(req, res) {
    const userId = req.user.id;

    try {
      await Loto.destroy({ where: { userId: userId } });
      await LotoCard.destroy({ where: { userId: userId } });
      return res.status(200).json("All data cleared");
    } catch (e) {
      console.log(e);
    }
  }

  async createCards(req, res) {
    try {
      let userId = req.user.id;
      let { cards } = req.body;

      await LotoCard.destroy({ where: { userId: userId } });

      let playerCandidate = await Loto.findOne({ where: { userId: userId } });
      if (!playerCandidate) {
        return res.status(400).json("You are not in the game room!!!");
      }

      const user = await User.findOne({ where: { id: userId } });
      const loto = await Loto.findOne({ where: { userId: user.id } });

      cards.forEach(async (cardArray) => {
        await LotoCard.create({
          userId: user.id,
          card: JSON.stringify(cardArray),
          lotoId: loto.id,
        });
      });

      return res.status(200).json("Вы купили карточку");
    } catch (e) {
      console.log(e);
    }
  }

  async getCards(req, res) {
    try {
      let userId = req.user.id;

      const user = await User.findOne({ where: { id: userId } });
      if (!user) {
        return req.status(400).json("User not found");
      }

      const cards = await LotoCard.findAll({ where: { userId: userId } });

      return res.json(cards);
    } catch (e) {
      console.log(e);
    }
  }

  async deleteCard(req, res) {
    try {
      const { cardId } = req.params;
      await LotoCard.destroy({ where: { id: cardId } });
      return res.status(200).json("Card deleted");
    } catch (e) {
      console.log(e);
    }
  }

  async deleteCards(req, res) {
    try {
      const userId = req.user.id;
      const { roomId } = req.query;
      await LotoCard.destroy({ where: { userId, gameLevel: +roomId } });
      return res.status(200).json("Cards deleted");
    } catch (e) {
      return res.status(400).json(e);
      console.log(e);
    }
  }

  async deleteCardsReturnBalance(req, res) {
    try {
      const userId = req.user.id;
      const { roomId, bet } = req.query;
      const userCards = await LotoCard.findAll({
        where: { userId, gameLevel: +roomId },
      });
      await LotoCard.destroy({ where: { userId, gameLevel: +roomId } });

      const user = await User.findOne({ where: { id: userId } });
      await User.update(
        { balance: user.balance + Number(bet) * userCards.length },
        { where: { id: userId } }
      );
      return res
        .status(200)
        .json({ balance: user.balance + Number(bet) * userCards.length });
    } catch (e) {
      return res.status(400).json(e);
      console.log(e);
    }
  }

  async getMessages(req, res) {
    let roomId = req.query.roomId;
    let userId = req.user.id;

    res.writeHead(200, {
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });

    const usersInRoom = await Loto.findAll({ where: { gameLevel: roomId } });

    let bet = 0;
    switch (roomId) {
      case "1":
        bet = 20;
        break;
      case "2":
        bet = 100;
        break;
      case "3":
        bet = 300;
        break;
    }

    let lotoGameInfo = await LotoGame.findOne({
      where: { gameLevel: roomId },
    });
    let defaultData = {
      information: {
        online: usersInRoom.length,
        bet,
        bank: bet * usersInRoom.length,
        startedAt: lotoGameInfo.startedAt,
      },
      queueFinished: false,
      gameStatus: false,
      game: {},
    };

    res.write(`data: ${JSON.stringify(defaultData)} \n\n`);

    if (roomId) {
      if (roomId != 1 && roomId != 2 && roomId != 3) {
        res.status(400).json("Room does not exist");
      }
      emitter.on(`loto-room-${roomId}`, (message) => {
        res.write(`data: ${JSON.stringify(message)} \n\n`);
      });
    }
  }

  async test(req, res) {
    await Loto.create({ gameLevel: 1, userId: 1 });
  }

  async getOnline(req, res) {
    // res.writeHead(200, {
    //   Connection: "keep-alive",
    //   "Content-Type": "text/event-stream",
    //   "Cache-Control": "no-cache",
    // });
    // const defaultMessage = {
    //   room1: 0,
    //   room2: 0,
    //   room3: 0,
    // };
    // res.write(`data: ${JSON.stringify(defaultMessage)} \n\n`);
    // emitter.on("online", async (message) => {
    //   res.write(`data: ${JSON.stringify(message)} \n\n`);
    // });
  }

  async getDominoStatus(req, res) {
    try {
      const userId = req.user.id;

      const player = await DominoGamePlayer.findOne({
        where: { userId },
        include: DominoGame,
      });

      if (player && player.dominoGame) {
        console.log(player);
        return res.status(200).json({
          message: true,
          roomInfo: {
            roomId: player.dominoGame.roomId,
            tableId: player.dominoGame.tableId,
            playerMode: player.dominoGame.playerMode,
            gameMode: player.dominoGame.gameMode,
          },
        });
      }

      return res.status(200).json({ message: false });
    } catch (e) {
      console.log(e);
    }
  }

  async isDominoStarted(req, res) {
    try {
      const userId = req.user.id;
      let { roomId, tableId, playerMode, gameMode } = req.body;

      const dominoGame = await DominoGame.findOne({
        where: {
          roomId: roomId,
          tableId: tableId,
          playerMode: playerMode,
          gameMode: gameMode,
        },
        include: DominoGamePlayer,
      });

      if (
        dominoGame.startedAt != null &&
        !dominoGame.dominoGamePlayers.find((player) => player.userId === userId)
      ) {
        return res.status(200).json({ allow: false });
      }

      return res.status(200).json({ allow: true });
    } catch (e) {
      console.log(e);
    }
  }
}

module.exports = new GameController();
