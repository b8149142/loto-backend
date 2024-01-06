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
const axios = require("axios");
const { literal, Op } = require("sequelize");

class dominoNavService {
  sendToClientsInTable(aWss, dominoRoomId, tableId, playerMode, gameMode, msg) {
    aWss.clients.forEach((client) => {
      if (
        client.dominoRoomId == dominoRoomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        client.send(JSON.stringify(msg));
      }
    });
  }

 async dominoRoomConnectionHandler(ws, aWss, msg, startTurn) {
    aWss.clients.forEach((user) => {
      if (
        user.playerMode == msg.playerMode &&
        user.dominoRoomId == msg.dominoRoomId &&
        user.tableId == msg.tableId &&
        user.userId == msg.userId &&
        user.username == msg.username
      ) {
        const response = {
          method: "dominoRoomIsGoing",
        };
        const response1 = {
          method: "alreadyInRoom",
        };
        ws.send(JSON.stringify(response1));
        return;
      }
    });

    ws.playerMode = msg.playerMode;
    ws.dominoRoomId = msg.dominoRoomId;
    ws.tableId = msg.tableId;
    ws.userId = msg.userId;
    ws.username = msg.username;
    ws.gameMode = msg.gameMode;
    ws.connectionDate = new Date().getTime();

    // get room online
    let online = this.getTableOnline(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode
    );

    let tableData = await DominoGame.findOne({
      where: {
        roomId: msg.dominoRoomId,
        tableId: msg.tableId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
    });

    if (tableData.isAvailable == false && !tableData.isStarted) {
      const response = {
        method: "roomIsNotAvailable",
      };
      ws.send(JSON.stringify(response));
      ws.playerMode = null;
      ws.dominoRoomId = null;
      ws.tableId = null;
      ws.gameMode = null;
      ws.connectionDate = null;
      return;
    }

    if (online > msg.playerMode) {
      const response = {
        method: "dominoRoomIsGoing",
      };
      ws.send(JSON.stringify(response));
      ws.playerMode = null;
      ws.dominoRoomId = null;
      ws.tableId = null;
      ws.gameMode = null;
      ws.connectionDate = null;
      return;
    }

    // console.log("msg.dominoRoomId", msg.dominoRoomId);

    // получаем время начала ожидания комнаты
    let time = null;
    if (online == 1 && !tableData.isStarted) {
      let date = await axios.get(
        "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      time = new Date(date.data.dateTime).getTime();

      await DominoGame.update(
        {
          startedWaitingAt: time,
        },
        {
          where: {
            roomId: msg.dominoRoomId,
            tableId: msg.tableId,
            playerMode: msg.playerMode,
            gameMode: msg.gameMode,
          },
        }
      );
    }

    tableData = await DominoGame.findOne({
      where: {
        roomId: msg.dominoRoomId,
        tableId: msg.tableId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
    });

    const userIds = [];
    aWss.clients.forEach((client) => {
      if (
        client.dominoRoomId == msg.dominoRoomId &&
        client.tableId == msg.tableId &&
        client.playerMode == msg.playerMode &&
        client.gameMode == msg.gameMode
      ) {
        userIds.push(client.userId);
      }
    });

    const users = await User.findAll({
      where: {
        id: userIds,
      },
    });

    let players = users.map((user) => {
      let connectionDate;
      aWss.clients.forEach((client) => {
        if (client.userId == user.id) {
          connectionDate = client.connectionDate;
        }
      });
      return {
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        connectionDate,
      };
    });

    roomsFunctions.sendAll(aWss, "connectDomino", msg);

    roomsFunctions.sendToClientsInTable(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode,
      {
        method: "waitingTableData",
        online,
        isStarted: tableData.isStarted,
        startedAt: tableData.startedAt,
        playerMode: msg.playerMode,
        dominoRoomId: msg.dominoRoomId,
        tableId: msg.tableId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
        startedWaitingAt: tableData.startedWaitingAt,
        players,
      }
    );

    online = this.getTableOnline(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode
    );
    if (online == msg.playerMode && !tableData.isStarted) {
      dominoGameService.startLobby(ws, aWss, msg, startTurn);
    }

    // await this.getAllDominoInfo(null, aWss);
  }


  async getAllDominoInfo(ws = null, aWss) {
    const clientsData = [];

    aWss.clients.forEach((client) => {
      if (client.dominoRoomId && client.tableId) {
        clientsData.push({
          dominoRoomId: client.dominoRoomId,
          tableId: client.tableId,
          userId: client.userId,
          username: client.username,
          playerMode: client.playerMode,
          gameMode: client.gameMode,
          connectionDate: client.connectionDate,
        });
      }
    });

    const dominoPlayers = await DominoGamePlayer.findAll();
    const allUsers = await User.findAll();

    let dominoInfo = [];

    // extracting unique domino room ids
    const dominoRooms = [
      ...new Set(
        clientsData.map((client) => {
          return {
            dominoRoomId: client.dominoRoomId,
            playerMode: client.playerMode,
            gameMode: client.gameMode,
          };
        })
      ),
    ];
    let dominoGames = await DominoGame.findAll({
      where: {
        roomId: dominoRooms.map((room) => room.dominoRoomId),
      },
    });

    // console.log(dominoGames.map((game) => game.roomId));

    // forming data for each domino room // тут получаем инфу только с вебсокетов (в которых есть люди)
    dominoRooms.forEach((dominoRoomObject) => {
      const dominoRoomData = clientsData.filter(
        (client) =>
          client.dominoRoomId == dominoRoomObject.dominoRoomId &&
          client.playerMode == dominoRoomObject.playerMode &&
          client.gameMode == dominoRoomObject.gameMode
      );
      const playerMode = dominoRoomData[0].playerMode;
      const gameMode = dominoRoomData[0].gameMode;

      // extracting unique table ids
      const tables = [
        ...new Set(dominoRoomData.map((client) => client.tableId)),
      ];
      const dominoRoom = {
        dominoRoomId: dominoRoomObject.dominoRoomId,
        playerMode,
        gameMode,
        tables: [],
      };
      tables.forEach((tableId) => {
        // getting data for each table in the room
        const tableData = dominoRoomData.filter(
          (client) => client.tableId == tableId
        );
        let players = tableData.map((client) => ({
          userId: client.userId,
          username: client.username,
          avatar: allUsers.find((user) => user.id == client.userId).avatar,
          connectionDate: client.connectionDate,
        }));
        // sort players by connection date
        players = players.sort((a, b) => {
          return (
            dominoRoomData.find((client) => client.userId == a.userId)
              .connectionDate -
            dominoRoomData.find((client) => client.userId == b.userId)
              .connectionDate
          );
        });
        const table = {
          tableId,
          online: tableData.length,
          players,
          startedAt: null,
          isStarted: false,
        };
        // record from database

        const tableRecord = dominoGames.find((game) => {
          return (
            game.roomId == dominoRoomObject.dominoRoomId &&
            game.tableId == tableId &&
            game.playerMode == playerMode &&
            game.gameMode == gameMode
          );
        });
        table.startedAt = tableRecord.startedAt;
        table.isStarted = tableRecord.isStarted;
        table.startedWaitingAt = tableRecord.startedWaitingAt;

        let tablePoints = dominoPlayers.filter(
          (player) => player.dominoGameId == tableRecord.id
        );
        tablePoints = tablePoints.map((player) => player.points);
        table.points = 0;
        if (tablePoints.length != 0) {
          table.points = Math.max(...tablePoints);
        }

        dominoRoom.tables.push(table);
      });
      dominoInfo.push(dominoRoom);
    });

    dominoGames = await DominoGame.findAll({
      where: {
        isStarted: true,
      },
    });
    // forming data for each domino room // тут получаем инфу только с базы (в которых нет людей)
    dominoGames.forEach((game) => {
      const dominoRoom = {
        dominoRoomId: game.roomId,
        playerMode: game.playerMode,
        gameMode: game.gameMode,
        tables: [
          {
            tableId: game.tableId,
            online: game.playerMode,
            players: [],
            startedAt: game.startedAt,
            isStarted: game.isStarted,
            startedWaitingAt: game.startedWaitingAt,
            points: 0,
          },
        ],
      };
      let tablePoints = dominoPlayers.filter(
        (player) => player.dominoGameId == game.id
      );
      tablePoints = tablePoints.map((player) => player.points);
      if (tablePoints.length != 0) {
        dominoRoom.tables[0].points = Math.max(...tablePoints);
      }
      dominoInfo.push(dominoRoom);
    });

    // if 2 objects in dominoInfo array have the same dominoRoomId, gameMode and playerMode then we need to merge them
    dominoInfo = dominoInfo.reduce((acc, cur) => {
      const index = acc.findIndex(
        (item) =>
          item.dominoRoomId == cur.dominoRoomId &&
          item.gameMode == cur.gameMode &&
          item.playerMode == cur.playerMode
      );

      if (index == -1) {
        acc.push(cur);
      } else {
        acc[index].tables = [...acc[index].tables, ...cur.tables];
      }
      return acc;
    }, []);

    // sending data to the client
    const response = {
      method: "getAllDominoInfo",
      dominoInfo,
    };
    if (ws) {
      ws.send(JSON.stringify(response));
    } else {
      roomsFunctions.sendAll(aWss, "getAllDominoInfo", response);
    }
  }

  async isDominoStarted(ws, msg) {
    try {
      let { dominoRoomId, tableId, playerMode, gameMode, userId } = msg;

      const dominoGame = await DominoGame.findOne({
        where: {
          roomId: dominoRoomId,
          tableId: tableId,
          playerMode: playerMode,
          gameMode: gameMode,
        },
        include: DominoGamePlayer,
      });

      // console.log(msg);

      if (
        dominoGame.startedAt != null &&
        !dominoGame.dominoGamePlayers.find((player) => player.userId === userId)
      ) {
        msg.allow = false;
        return ws.send(JSON.stringify(msg));
      }

      msg.allow = true;
      return ws.send(JSON.stringify(msg));
    } catch (e) {
      console.log(e);
    }
  }

  async removeUserFromTable(aWss, msg) {
    const { dominoRoomId, tableId, playerMode, userId, gameMode } = msg;

    // console.log(dominoRoomId, tableId, playerMode, userId, gameMode);
    const dominoGame = await DominoGame.findOne({
      where: { roomId: dominoRoomId, tableId, playerMode, gameMode },
    });
    // console.log(gameMode == "TELEPHONE");
    // console.log(dominoGame);

    // if(dominoGame.isStarted)
    await DominoGamePlayer.destroy({
      where: { dominoGameId: dominoGame.id, userId },
    });

    const online = this.getTableOnline(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode
    );

    const userIds = [];
    aWss.clients.forEach((client) => {
      if (
        client.dominoRoomId == msg.dominoRoomId &&
        client.tableId == msg.tableId &&
        client.playerMode == msg.playerMode &&
        client.gameMode == msg.gameMode
      ) {
        userIds.push(client.userId);
      }
    });

    const users = await User.findAll({
      where: {
        id: userIds,
      },
    });
    let players = users.map((user) => {
      let connectionDate;
      aWss.clients.forEach((client) => {
        if (client.userId == user.id) {
          connectionDate = client.connectionDate;
        }
      });
      return {
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        connectionDate,
      };
    });

    roomsFunctions.sendToClientsInTable(
      aWss,
      dominoRoomId,
      tableId,
      playerMode,
      gameMode,
      {
        method: "waitingTableData",
        online,
        isStarted: dominoGame.isStarted,
        startedAt: dominoGame.startedAt,
        playerMode,
        players,
      }
    );
  }

  getTableOnline(aWss, dominoRoomId, tableId, playerMode, gameMode) {
    let online = 0;
    aWss.clients.forEach((client) => {
      if (
        client.dominoRoomId == dominoRoomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        online++;
      }
    });

    return online;
  }

  async getAllTablesStartTimers() {
    return 0;
  }
}

module.exports = new dominoNavService();
