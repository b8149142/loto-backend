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
const { literal } = require("sequelize");

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
    ws.playerMode = msg.playerMode;
    ws.dominoRoomId = msg.dominoRoomId;
    ws.tableId = msg.tableId;
    ws.userId = msg.userId;
    ws.username = msg.username;
    ws.gameMode = msg.gameMode;

    // get room online
    const online = this.getTableOnline(
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

    if (online > msg.playerMode) {
      return;
    }

    // console.log("msg.dominoRoomId", msg.dominoRoomId);

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
      }
    );

    if (online == msg.playerMode && !tableData.isStarted) {
      dominoGameService.startLobby(ws, aWss, msg, startTurn);
    }
  }

  async getAllDominoInfo(ws = null, aWss) {
    // example of info array
    // const dominoInfo = [
    //   // empty rooms and tables are not included
    //   {
    //     dominoRoomId: 2,
    //     // max amount of players in room (2 or 4)
    //     playerMode: 4,
    //     gameMode: "CLASSIC",
    //     tables: [
    //       {
    //         tableId: 1,
    //         online: 4,
    //         // user ids and usernames
    //         players: [{ userId: 14, username: "bebra" }, {}, {}, {}],
    //         // date when count down starts
    //         startedAt: "2023-09-19 19:25:52",
    //         isStarted: false,
    //       },
    //       {
    //         tableId: 3,
    //         online: 3,
    //         players: [{}, {}, {}],
    //         // when started, no date, and show game started label
    //         startedAt: null,
    //         isStarted: true,
    //       },
    //     ],
    //   },
    // ];

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
        });
      }
    });

    // form data as in the example

    const dominoInfo = [];

    // extracting unique domino room ids
    const dominoRooms = [
      ...new Set(clientsData.map((client) => client.dominoRoomId)),
    ];
    const dominoGames = await DominoGame.findAll({
      where: { roomId: dominoRooms },
    });

    // forming data for each domino room
    dominoRooms.forEach((dominoRoomId) => {
      const dominoRoomData = clientsData.filter(
        (client) => client.dominoRoomId == dominoRoomId
      );
      const playerMode = dominoRoomData[0].playerMode;
      const gameMode = dominoRoomData[0].gameMode;

      // extracting unique table ids
      const tables = [
        ...new Set(dominoRoomData.map((client) => client.tableId)),
      ];
      const dominoRoom = {
        dominoRoomId,
        playerMode,
        gameMode,
        tables: [],
      };
      tables.forEach((tableId) => {
        // getting data for each table in the room
        const tableData = dominoRoomData.filter(
          (client) => client.tableId == tableId
        );
        const table = {
          tableId,
          online: tableData.length,
          players: tableData.map((client) => ({
            userId: client.userId,
            username: client.username,
          })),
          startedAt: null,
          isStarted: false,
        };
        // record from database
        const tableRecord = dominoGames.find(
          (game) => game.roomId == dominoRoomId && game.tableId == tableId
        );
        table.startedAt = tableRecord.startedAt;
        table.isStarted = tableRecord.isStarted;
        dominoRoom.tables.push(table);
      });
      dominoInfo.push(dominoRoom);
    });

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

  async removeUserFromTable(aWss, msg) {
    const { dominoRoomId, tableId, playerMode, userId, gameMode } = msg;

    console.log(dominoRoomId, tableId, playerMode, userId, gameMode);
    const dominoGame = await DominoGame.findOne({
      where: { roomId: dominoRoomId, tableId, playerMode, gameMode },
    });
    console.log(gameMode == "TELEPHONE");
    console.log(dominoGame);

    await DominoGamePlayer.destroy({
      where: { dominoGameId: dominoGame.id, userId },
    });

    const online = this.getTableOnline(aWss, dominoRoomId, tableId, playerMode);

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
