const { random } = require("../db");
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
  DominoUserGame,
} = require("../models/db-models");
const lotoAdminService = require("./loto-admin-service");
const roomsFunctions = require("./loto-rooms-functions");
const axios = require("axios");
const { literal, where } = require("sequelize");

class dominoGameService {
  // aWss,
  // msg.dominoRoomId,
  // msg.tableId,
  // msg.playerMode,
  // firstPlayerId,
  // turnTime

  async startLobby(ws, aWss, msg, startTurn) {
    // find users in this table
    let usersInThisTable = [];
    for (const client of aWss.clients) {
      if (
        client.dominoRoomId == msg.dominoRoomId &&
        client.tableId == msg.tableId &&
        client.playerMode == msg.playerMode &&
        client.gameMode == msg.gameMode
      ) {
        usersInThisTable.push({
          userId: client.userId,
          username: client.username,
        });
      }
    }
    // получаем игру
    let dominoGame = await DominoGame.findOne({
      where: {
        tableId: msg.tableId,
        roomId: msg.dominoRoomId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
      include: DominoGamePlayer,
    });

    // если игра началась то прерываемся
    if (dominoGame.isStarted) {
      return;
    }

    // console.log("usersInThisTable", usersInThisTable, usersInThisTable.length);

    const betInfo = this.getDominoRoomBetInfo(msg.dominoRoomId);

    for (const player of usersInThisTable) {
      let newUser = await DominoGamePlayer.create({
        userId: player.userId,
        dominoGameId: dominoGame.id,
      });
      // take money
      await User.update(
        {
          balance: literal(`balance - ${betInfo.bet}`),
        },
        {
          where: {
            id: player.userId,
          },
        }
      );
    }

    let date = await axios.get(
      "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const time = new Date(date.data.dateTime).getTime();

    // add record to db
    await DominoGame.update(
      { startedAt: time, startedWaitingAt: null },
      {
        where: {
          tableId: msg.tableId,
          roomId: msg.dominoRoomId,
          playerMode: msg.playerMode,
          gameMode: msg.gameMode,
        },
      }
    );

    // получаем обновленную игру

    dominoGame = await DominoGame.findOne({
      where: {
        tableId: msg.tableId,
        roomId: msg.dominoRoomId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
      include: DominoGamePlayer,
    });

    // console.log("usersInThisTable", usersInThisTable.length, usersInThisTable);

    // отправляем на клиент сообщение о старте игр
    let timerMessage = {
      startedAt: time,
      tableId: msg.tableId,
      dominoRoomId: msg.dominoRoomId,
      playerMode: msg.playerMode,
      gameMode: msg.gameMode,
      dominoGameId: dominoGame.id,
      method: "startDominoTableTimerTable",
    };
    roomsFunctions.sendAll(aWss, "startDominoTableTimerMenu", timerMessage);

    let roomPlayers = dominoGame.dominoGamePlayers;
    // console.log(dominoGame);
    // console.log(roomPlayers);

    let playersData = [];
    for (const player of roomPlayers) {
      let user = await User.findOne({ where: { id: player.userId } });
      if (user) {
        let playerData = {
          userId: user.id,
          avatar: user.avatar,
          username: user.username,
        };
        playersData.push(playerData);
      }
    }
    timerMessage.method = "startDominoTableTimerTable";
    timerMessage.players = playersData;
    roomsFunctions.sendToClientsInTable(
      aWss,
      msg.dominoRoomId,
      msg.tableId,
      msg.playerMode,
      msg.gameMode,
      timerMessage
    );

    const turnQueue = [];
    usersInThisTable.forEach((user) => {
      turnQueue.push(user.userId);
    });

    shuffle(turnQueue);

    // находим игрока который ходит первый
    const { playersTiles, marketTiles } = generateAndSortTiles(
      dominoGame.dominoGamePlayers,
      msg.playerMode,
      turnQueue,
      msg.gameMode
    );

    // console.log("playerTiles ", playersTiles);

    // обновляем игру и добавляем очередь ходов
    let scene = createEmptyScene();

    await DominoGame.update(
      {
        isStarted: true,
        turnQueue: JSON.stringify(turnQueue),
        scene: JSON.stringify(scene),
      },
      { where: { id: dominoGame.id } }
    );

    let gameMessage = {
      tableId: msg.tableId,
      dominoRoomId: msg.dominoRoomId,
      playerMode: msg.playerMode,
      gameMode: msg.gameMode,
    };
    roomsFunctions.sendAll(aWss, "startDominoGameMenu", gameMessage);

    // создаем базар в базу даных на комнату и стол

    date = await axios.get(
      "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    const turnTime = new Date(date.data.dateTime).getTime();

    await createMarketInRoom(
      msg.tableId,
      msg.dominoRoomId,
      msg.playerMode,
      msg.gameMode,
      marketTiles
    );

    // создаем пользователям костяшки
    await createPlayersTiles(aWss, msg, playersTiles, dominoGame);

    // отправляем информацию о начале игры
    // players= [{username: '2voby', tiles: [], score: 0}, {username: '2voby', tiles: [], score: 0}]
    // [{username: '2voby', userId: 1, tiles: [], score: 0}, {}}]

    const allUsers = await User.findAll();

    const players = await DominoGamePlayer.findAll({
      where: { dominoGameId: dominoGame.id },
    });
    usersInThisTable.forEach((user) => {
      players.forEach((player) => {
        if (user.userId == player.userId) {
          user.tiles = JSON.parse(player.tiles);
          user.score = 0;
        }
      });
      allUsers.forEach((userData) => {
        if (userData.id == user.userId) {
          user.avatar = userData.avatar;
        }
      });
    });

    const firstPlayerId = playersTiles.find((player) => player.isFirst).userId;

    // запускаем ожидание до старта игры

    setTimeout(async () => {
      let roombet = this.getDominoRoomBetInfo(msg.dominoRoomId).bet;

      gameMessage.players = usersInThisTable;
      gameMessage.market = marketTiles;
      gameMessage.turnQueue = turnQueue;
      gameMessage.turn = firstPlayerId;
      gameMessage.turnTime = turnTime + 10000;
      gameMessage.continued = false;
      gameMessage.scene = scene;
      gameMessage.bet = roombet;
      gameMessage.method = "startDominoGameTable";

      // запускаем отчет следующего хода

      await startTurn(
        aWss,
        msg.dominoRoomId,
        msg.tableId,
        msg.playerMode,
        msg.gameMode,
        firstPlayerId,
        turnTime + 10000
      );

      // отправляем сообщение всем игрокам в комнате о начале игры
      roomsFunctions.sendToClientsInTable(
        aWss,
        msg.dominoRoomId,
        msg.tableId,
        msg.playerMode,
        msg.gameMode,
        gameMessage
      );
    }, 10000);
  }

  async placeTile(ws, aWss, msg) {
    let tile = msg.tile;
    let sisterTile = msg.sisterTile;
    let isPlaced = false;

    // console.log(
    //   msg.tableId,
    //   msg.roomId,
    //   msg.playerMode,
    //   msg.gameMode,
    //   "fhjkdafslkfadhsljkfdhadjsklfhadlskfhyjklsadwrfhkljswaderhkjlf"
    // );

    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: msg.tableId,
        roomId: msg.roomId,
        playerMode: msg.playerMode,
        gameMode: msg.gameMode,
      },
      include: DominoGamePlayer,
    });

    const scene = JSON.parse(dominoGame.scene);

    // console.log("TOP-2", scene[Math.floor(scene.length / 2) - 3]);
    // console.log("TOP-1", scene[Math.floor(scene.length / 2) - 2]);
    // console.log("TOP", scene[Math.floor(scene.length / 2) - 1]);
    // console.log("MIDDLE", scene[Math.floor(scene.length / 2)]);
    // console.log("BOTTOM", scene[Math.floor(scene.length / 2) + 1]);

    if (msg.gameMode == "CLASSIC") {
      let isPlaced = await this.placeClassicTile(
        ws,
        aWss,
        tile,
        scene,
        dominoGame,
        msg
      );
      return isPlaced;
    } else {
      let isPlaced = await this.placeTelephoneTile(
        ws,
        aWss,
        tile,
        scene,
        dominoGame,
        msg
      );
      return isPlaced;
    }
  }

  countTiles(scene) {
    let tilesAmount = 0;
    scene.forEach((row) => {
      row.forEach((tile) => {
        if (tile?.id >= 0) {
          tilesAmount++;
        }
      });
    });
    return tilesAmount;
  }

  async placeClassicTile(ws, aWss, tile, scene, dominoGame, msg) {
    let isPlaced = false;
    let tilesAmount = this.countTiles(scene);
    let sisterTile = msg.sisterTile;

    // console.log("BEBRA", scene[Math.floor(scene.length / 2)]);

    if (tilesAmount == 0) {
      // console.log("tile = 0");

      if (tile.left == tile.right) {
        // find central element in 2d scene
        scene[Math.floor(scene.length / 2)][
          Math.floor(scene[Math.floor(scene.length / 2)].length / 2)
        ] = {
          left: tile.left,
          right: tile.right,
          id: tile.id,
          rotate: true,
          position: "row",
        };

        await dominoGame.update({ scene: JSON.stringify(scene) });

        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        isPlaced = true;
        return isPlaced;
      }
    }

    if (tilesAmount == 1) {
      // console.log("tile = 1");

      let centralTile =
        scene[Math.floor(scene.length / 2)][
          Math.floor(scene[Math.floor(scene.length / 2)].length / 2)
        ];

      if (centralTile.right == tile.left || centralTile.right == tile.right) {
        // console.log("addTile", tile, "to", centralTile);
        await addTileToRight(
          tile,
          centralTile,
          dominoGame,
          scene,
          centralTile.right == tile.right
        );
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        isPlaced = true;
        return isPlaced;
      }
    }

    if (tilesAmount > 1) {
      // console.log("tile > 1");

      let newScene = scene[Math.floor(scene.length / 2)];

      let leftTile = null;
      let rightTile = null;
      for (let i = 0; i < newScene.length; i++) {
        if (newScene[i]?.id >= 0 && !leftTile) {
          leftTile = newScene[i];
        }
      }
      for (let i = newScene.length - 1; i >= 0; i--) {
        if (newScene[i]?.id >= 0 && !rightTile) {
          rightTile = newScene[i];
        }
      }

      // console.log("left", leftTile);
      // console.log("right", rightTile);

      if (sisterTile && sisterTile == "right") {
        if (rightTile.right == tile.left || rightTile.right == tile.right) {
          await addTileToRight(
            tile,
            rightTile,
            dominoGame,
            scene,
            rightTile.right == tile.right
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          if (msg.gameMode == "TELEPHONE") {
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
          }
          isPlaced = true;
          return isPlaced;
        }
      } else if (sisterTile && sisterTile == "left") {
        if (leftTile.left == tile.right || leftTile.left == tile.left) {
          await addTileToLeft(
            tile,
            leftTile,
            dominoGame,
            scene,
            leftTile.left == tile.left
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          if (msg.gameMode == "TELEPHONE") {
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
          }
          isPlaced = true;
          return isPlaced;
        }
      }

      if (rightTile.right == tile.left || rightTile.right == tile.right) {
        await addTileToRight(
          tile,
          rightTile,
          dominoGame,
          scene,
          rightTile.right == tile.right
        );
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        if (msg.gameMode == "TELEPHONE") {
          await this.addTelephoneScore(
            aWss,
            scene,
            msg.userId,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode
          );
        }
        isPlaced = true;
        return isPlaced;
      } else if (leftTile.left == tile.right || leftTile.left == tile.left) {
        await addTileToLeft(
          tile,
          leftTile,
          dominoGame,
          scene,
          leftTile.left == tile.left
        );
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        if (msg.gameMode == "TELEPHONE") {
          await this.addTelephoneScore(
            aWss,
            scene,
            msg.userId,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode
          );
        }
        isPlaced = true;
        return isPlaced;
      }
    }
  }

  async placeTelephoneTile(ws, aWss, tile, scene, dominoGame, msg) {
    let isPlaced = false;
    let tilesAmount = this.countTiles(scene);
    let sisterTile = msg.sisterTile;

    if (tilesAmount == 0) {
      // find central element in 2d scene
      scene[Math.floor(scene.length / 2)][
        Math.floor(scene[Math.floor(scene.length / 2)].length / 2)
      ] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: tile.left == tile.right,
        position: "row",
      };

      await dominoGame.update({ scene: JSON.stringify(scene) });

      await deleteUserInventoryTile(
        ws,
        aWss,
        tile,
        msg.roomId,
        msg.tableId,
        msg.playerMode,
        msg.gameMode,
        msg.userId
      );
      await this.addTelephoneScore(
        aWss,
        scene,
        msg.userId,
        msg.roomId,
        msg.tableId,
        msg.playerMode,
        msg.gameMode
      );
      isPlaced = true;
      return isPlaced;
    }

    // console.log(3333, "tilesAmount:", tilesAmount);

    if (tilesAmount == 1) {
      let centralTile =
        scene[Math.floor(scene.length / 2)][
          Math.floor(scene[Math.floor(scene.length / 2)].length / 2)
        ];
      // console.log("CENTRAL TILE", centralTile);

      if (centralTile.right == tile.left || centralTile.right == tile.right) {
        // console.log("addTile", tile, "to", centralTile);
        await addTileToRight(
          tile,
          centralTile,
          dominoGame,
          scene,
          centralTile.right == tile.right
        );
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        await this.addTelephoneScore(
          aWss,
          scene,
          msg.userId,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode
        );
        isPlaced = true;
        return isPlaced;
      } else if (
        centralTile.left == tile.left ||
        centralTile.left == tile.right
      ) {
        await addTileToLeft(
          tile,
          centralTile,
          dominoGame,
          scene,
          centralTile.left == tile.left
        );
        await deleteUserInventoryTile(
          ws,
          aWss,
          tile,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode,
          msg.userId
        );
        await this.addTelephoneScore(
          aWss,
          scene,
          msg.userId,
          msg.roomId,
          msg.tableId,
          msg.playerMode,
          msg.gameMode
        );
        isPlaced = true;
        return isPlaced;
      }
    }

    if (tilesAmount > 1) {
      // find if there is vertical, if no, do as in classic, else find top and bottom tiles and place tile
      const areVerticalsFilled = this.checkIfVerticalsFilled(scene);

      if (!areVerticalsFilled) {
        // same as classic but check also double tiles
        let newScene = scene[Math.floor(scene.length / 2)];

        let leftTile = null;
        let rightTile = null;
        let doubleTiles = [];
        let availableDoubles = [];

        for (let i = 0; i < newScene.length; i++) {
          if (newScene[i]?.id >= 0 && !leftTile) {
            leftTile = newScene[i];
          }
        }
        for (let i = newScene.length - 1; i >= 0; i--) {
          if (newScene[i]?.id >= 0 && !rightTile) {
            rightTile = newScene[i];
          }
        }

        // find all double tiles on the scene
        newScene.forEach((tile) => {
          if (tile?.left == tile?.right && tile?.id >= 0) {
            doubleTiles.push(tile);
          }
        });

        // console.log("double-tiles", doubleTiles);
        // find all available doubles on the scene (needs to be placed between 2 tiles)
        doubleTiles.forEach((tile) => {
          // check if on the right and left of double there are tiles
          if (tile.id >= 0 && tile.central == true) {
            availableDoubles.push(tile);
          }
        });

        // console.log("SISTER TILE", sisterTile);

        if (sisterTile && sisterTile == "right") {
          if (rightTile.right == tile.left || rightTile.right == tile.right) {
            await addTileToRight(
              tile,
              rightTile,
              dominoGame,
              scene,
              rightTile.right == tile.right
            );
            await deleteUserInventoryTile(
              ws,
              aWss,
              tile,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode,
              msg.userId
            );
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
            isPlaced = true;
            return isPlaced;
          }
        } else if (sisterTile && sisterTile == "left") {
          if (leftTile.left == tile.right || leftTile.left == tile.left) {
            await addTileToLeft(
              tile,
              leftTile,
              dominoGame,
              scene,
              leftTile.left == tile.left
            );
            await deleteUserInventoryTile(
              ws,
              aWss,
              tile,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode,
              msg.userId
            );
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
            isPlaced = true;
            return isPlaced;
          }
        } else if (sisterTile && sisterTile == "top") {
          let middleTile = newScene.find(
            (sceneTile) =>
              sceneTile.central == true &&
              sceneTile.left == sceneTile.right &&
              (sceneTile.left == tile.left || sceneTile.left == tile.right)
          );
          if (middleTile) {
            await addTileToTop(
              tile,
              middleTile,
              dominoGame,
              scene,
              middleTile.left == tile.left
            );
            await deleteUserInventoryTile(
              ws,
              aWss,
              tile,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode,
              msg.userId
            );
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
            isPlaced = true;
            return isPlaced;
          }
        }

        if (rightTile.right == tile.left || rightTile.right == tile.right) {
          await addTileToRight(
            tile,
            rightTile,
            dominoGame,
            scene,
            rightTile.right == tile.right
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          await this.addTelephoneScore(
            aWss,
            scene,
            msg.userId,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode
          );
          isPlaced = true;
          return isPlaced;
        }
        if (leftTile.left == tile.right || leftTile.left == tile.left) {
          await addTileToLeft(
            tile,
            leftTile,
            dominoGame,
            scene,
            leftTile.left == tile.left
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          await this.addTelephoneScore(
            aWss,
            scene,
            msg.userId,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode
          );
          isPlaced = true;
          return isPlaced;
        }

        // check for double tiles to place on top of them
        if (availableDoubles.length > 0) {
          let isPlaced = false;
          for (const doubleTile of availableDoubles) {
            if (doubleTile.left == tile.left || doubleTile.left == tile.right) {
              await addTileToTop(
                tile,
                doubleTile,
                dominoGame,
                scene,
                doubleTile.left == tile.left
              );

              // await addTileToBottom(
              //   tile,
              //   doubleTile,
              //   dominoGame,
              //   scene,
              //   doubleTile.right == tile.right
              // );
              await deleteUserInventoryTile(
                ws,
                aWss,
                tile,
                msg.roomId,
                msg.tableId,
                msg.playerMode,
                msg.gameMode,
                msg.userId
              );
              await this.addTelephoneScore(
                aWss,
                scene,
                msg.userId,
                msg.roomId,
                msg.tableId,
                msg.playerMode,
                msg.gameMode
              );
              isPlaced = true;
            }
          }

          return isPlaced;
        }
      } else if (areVerticalsFilled) {
        // same as classic but check also double tiles
        let newScene = scene[Math.floor(scene.length / 2)];

        let { top, bottom } = this.findVerticalCorners(scene);

        let leftTile = null;
        let rightTile = null;

        // find all available doubles on the scene (needs to be placed between 2 tiles)

        for (let i = 0; i < newScene.length; i++) {
          if (newScene[i]?.id >= 0 && !leftTile) {
            leftTile = newScene[i];
          }
        }
        for (let i = newScene.length - 1; i >= 0; i--) {
          if (newScene[i]?.id >= 0 && !rightTile) {
            rightTile = newScene[i];
          }
        }

        if (sisterTile && sisterTile == "right") {
          if (rightTile.right == tile.left || rightTile.right == tile.right) {
            await addTileToRight(
              tile,
              rightTile,
              dominoGame,
              scene,
              rightTile.right == tile.right
            );
            await deleteUserInventoryTile(
              ws,
              aWss,
              tile,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode,
              msg.userId
            );
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
            isPlaced = true;
            return isPlaced;
          }
        } else if (sisterTile && sisterTile == "left") {
          if (leftTile.left == tile.right || leftTile.left == tile.left) {
            await addTileToLeft(
              tile,
              leftTile,
              dominoGame,
              scene,
              leftTile.left == tile.left
            );
            await deleteUserInventoryTile(
              ws,
              aWss,
              tile,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode,
              msg.userId
            );
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
            isPlaced = true;
            return isPlaced;
          }
        } else if (sisterTile && sisterTile == "top") {
          if (top.left == tile.right || top.left == tile.left) {
            await addTileToTop(
              tile,
              top,
              dominoGame,
              scene,
              top.left == tile.left
            );
            await deleteUserInventoryTile(
              ws,
              aWss,
              tile,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode,
              msg.userId
            );
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
            isPlaced = true;
            return isPlaced;
          }
        } else if (sisterTile && sisterTile == "bottom") {
          if (bottom.right == tile.right || bottom.right == tile.left) {
            await addTileToBottom(
              tile,
              bottom,
              dominoGame,
              scene,
              bottom.right == tile.right
            );
            await deleteUserInventoryTile(
              ws,
              aWss,
              tile,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode,
              msg.userId
            );
            await this.addTelephoneScore(
              aWss,
              scene,
              msg.userId,
              msg.roomId,
              msg.tableId,
              msg.playerMode,
              msg.gameMode
            );
            isPlaced = true;
            return isPlaced;
          }
        }

        // ==============================

        if (rightTile.right == tile.left || rightTile.right == tile.right) {
          await addTileToRight(
            tile,
            rightTile,
            dominoGame,
            scene,
            rightTile.right == tile.right
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          await this.addTelephoneScore(
            aWss,
            scene,
            msg.userId,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode
          );
          isPlaced = true;
          return isPlaced;
        } else if (leftTile.left == tile.right || leftTile.left == tile.left) {
          await addTileToLeft(
            tile,
            leftTile,
            dominoGame,
            scene,
            leftTile.left == tile.left
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          await this.addTelephoneScore(
            aWss,
            scene,
            msg.userId,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode
          );
          isPlaced = true;
          return isPlaced;
        }

        // аставить проверку для верх\низ
        if (top.left == tile.left || top.left == tile.right) {
          await addTileToTop(
            tile,
            top,
            dominoGame,
            scene,
            top.left == tile.left
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          await this.addTelephoneScore(
            aWss,
            scene,
            msg.userId,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode
          );
          isPlaced = true;
          return isPlaced;
        }

        if (bottom.right == tile.left || bottom.right == tile.right) {
          await addTileToBottom(
            tile,
            bottom,
            dominoGame,
            scene,
            bottom.right == tile.right
          );
          await deleteUserInventoryTile(
            ws,
            aWss,
            tile,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode,
            msg.userId
          );
          await this.addTelephoneScore(
            aWss,
            scene,
            msg.userId,
            msg.roomId,
            msg.tableId,
            msg.playerMode,
            msg.gameMode
          );
          isPlaced = true;
          return isPlaced;
        }
      }
    }
  }

  async addTelephoneScore(
    aWss,
    scene,
    userId,
    roomId,
    tableId,
    playerMode,
    gameMode
  ) {
    let score = 0;
    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode: gameMode,
      },
      include: DominoGamePlayer,
    });
    let tilesAmount = this.countTiles(scene);
    let newScene = scene[Math.floor(scene.length / 2)];
    // let tilesAmount = this.countTiles(scene);
    let leftTile = null;
    let rightTile = null;
    for (let i = 0; i < newScene.length; i++) {
      if (newScene[i]?.id >= 0 && !leftTile) {
        leftTile = newScene[i];
      }
    }
    for (let i = newScene.length - 1; i >= 0; i--) {
      if (newScene[i]?.id >= 0 && !rightTile) {
        rightTile = newScene[i];
      }
    }

    const { top, bottom } = this.findVerticalCorners(scene);

    // тут
    const availableDoubles = [];

    scene = scene[Math.floor(scene.length / 2)];
    const allDoubles = scene.filter((tile) => tile.left == tile.right);
    allDoubles.forEach((tile) => {
      // check if on the right and left of double there are tiles
      const leftTile = scene[scene.indexOf(tile) - 1];
      const rightTile = scene[scene.indexOf(tile) + 1];
      if (leftTile && rightTile && leftTile?.id >= 0 && rightTile?.id >= 0) {
        availableDoubles.push(tile);
      }
    });

    const leftTileDouble = availableDoubles.some(
      (obj) => obj.id === leftTile.id
    );
    const rightTileDouble = availableDoubles.some(
      (obj) => obj.id === rightTile.id
    );
    let topTileDouble = null;
    let bottomTileDouble = null;
    if (top && bottom) {
      topTileDouble = availableDoubles.some((obj) => obj.id === top.id);
      bottomTileDouble = availableDoubles.some((obj) => obj.id === bottom.id);
    }

    if (leftTile && rightTile && leftTile.id == rightTile.id) {
      if (leftTile.right == leftTile.left) {
        score += leftTile.left * 2;
      } else {
        score += leftTile.left;
        score += leftTile.right;
      }
    } else {
      if (leftTile.right == leftTile.left) {
        score += leftTile.left * 2;
      } else {
        score += leftTile.left;
      }

      if (rightTile.right == rightTile.left) {
        score += rightTile.right * 2;
      } else {
        score += rightTile.right;
      }
    }

    if (top && !topTileDouble) {
      if (top.left == top.right) {
        score += top.left * 2;
      } else {
        score += top.left;
      }
    }
    if (bottom && !bottomTileDouble) {
      if (bottom.left == bottom.right) {
        score += bottom.right * 2;
      } else {
        score += bottom.right;
      }
    }

    // убираем очки если 1 тайл на сцене и он не парный
    if (tilesAmount == 1 && leftTile.left != rightTile.right) {
      score = 0;
    }

    // console.log("score", score);
    if (score % 5 == 0) {
      const player = await DominoGamePlayer.findOne({
        where: {
          dominoGameId: dominoGame.id,
          userId: userId,
        },
      });
      await DominoGamePlayer.update(
        {
          points: literal(`points + ${score}`),
        },
        {
          where: {
            dominoGameId: dominoGame.id,
            userId: userId,
          },
        }
      );
      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        {
          method: "updatePlayerScore",
          userId,
          score: player.points + score,
          addedScore: score,
        }
      );

      // get updated players array
      const playersInRoom = await DominoGamePlayer.findAll({
        where: {
          dominoGameId: dominoGame.id,
        },
      });

      // make array of just score numbers, find max
      const scores = playersInRoom.map((player) => player.points);
      let maxScore = 0;
      maxScore = Math.max(...scores);
      // send score of table to all users
      aWss.clients.forEach((client) => {
        client.send(
          JSON.stringify({
            method: "updateTableScore",
            roomId,
            tableId,
            playerMode,
            gameMode,
            points: maxScore,
          })
        );
      });
      return;
    }
  }

  async placeTileOnSkippedTurn(aWss, dominoGamePast, turn, gameMode) {
    // return;
    let dominoGame = dominoGamePast;
    let roomId = dominoGame.roomId;
    let tableId = dominoGame.tableId;
    let playerMode = dominoGame.playerMode;

    let scene = JSON.parse(dominoGame.scene);
    const market = JSON.parse(dominoGame.market);
    const playersInRoom = dominoGame.dominoGamePlayers;
    const user = playersInRoom.find((player) => player.userId == turn);
    let currWs = null;
    aWss.clients.forEach((client) => {
      if (client.userId == turn) {
        currWs = client;
      }
    });
    if (currWs) {
      currWs.send(JSON.stringify({ method: "THIS_CLIENT_NOW" }));
    }
    let turnAvailable = this.isTurnAvailable(
      JSON.parse(user.tiles),
      scene,
      gameMode
    );

    if (turnAvailable && gameMode == "CLASSIC") {
      let newScene = scene[Math.floor(scene.length / 2)];
      let tilesAmount = this.countTiles(scene);
      const tiles = JSON.parse(user.tiles);
      let leftTile = null;
      let rightTile = null;
      for (let i = 0; i < newScene.length; i++) {
        if (newScene[i]?.id >= 0 && !leftTile) {
          leftTile = newScene[i];
        }
      }
      for (let i = newScene.length - 1; i >= 0; i--) {
        if (newScene[i]?.id >= 0 && !rightTile) {
          rightTile = newScene[i];
        }
      }

      let tileToPlace = null;
      const availableTilesToPlace = [];

      if (tilesAmount == 0) {
        tiles.forEach((tile) => {
          if (tile.left == tile.right) {
            availableTilesToPlace.push(tile);
          }
        });
      } else {
        tiles.forEach((tile) => {
          if (tile.left == leftTile.left || tile.right == leftTile.left) {
            availableTilesToPlace.push(tile);
          }
          if (tile.left == rightTile.right || tile.right == rightTile.right) {
            availableTilesToPlace.push(tile);
          }
        });
      }

      if (availableTilesToPlace.length > 0) {
        tileToPlace = availableTilesToPlace[0];
        availableTilesToPlace.forEach((tile) => {
          if (tile.left + tile.right < tileToPlace.left + tileToPlace.right) {
            tileToPlace = tile;
          }
        });
      }

      if (tileToPlace) {
        const msg = {
          tile: tileToPlace,
          sisterTile: null,
          roomId,
          tableId,
          playerMode,
          gameMode,
          userId: turn,
        };

        const isPlaced = await this.placeTile(currWs, aWss, msg);
        if (isPlaced) {
          await this.sendNewScene(
            currWs,
            aWss,
            roomId,
            tableId,
            playerMode,
            gameMode,
            turn
          );
        }
      }
    } else if (turnAvailable && gameMode == "TELEPHONE") {
      let newScene = scene[Math.floor(scene.length / 2)];
      let tilesAmount = this.countTiles(scene);
      const tiles = JSON.parse(user.tiles);
      let leftTile = null;
      let rightTile = null;
      for (let i = 0; i < newScene.length; i++) {
        if (newScene[i]?.id >= 0 && !leftTile) {
          leftTile = newScene[i];
        }
      }
      for (let i = newScene.length - 1; i >= 0; i--) {
        if (newScene[i]?.id >= 0 && !rightTile) {
          rightTile = newScene[i];
        }
      }

      let tileToPlace = null;
      const availableTilesToPlace = [];

      const { top, bottom } = this.findVerticalCorners(scene);

      if (tilesAmount == 0) {
        tiles.forEach((tile) => {
          if (tile.left == tile.right) {
            availableTilesToPlace.push(tile);
          }
        });
      } else {
        tiles.forEach((tile) => {
          if (tile.left == leftTile.left || tile.right == leftTile.left) {
            availableTilesToPlace.push(tile);
          }
          if (tile.left == rightTile.right || tile.right == rightTile.right) {
            availableTilesToPlace.push(tile);
          }

          if (top && (top?.left == tile.left || top?.left == tile.right)) {
            availableTilesToPlace.push(tile);
          }
          if (
            bottom &&
            (bottom?.right == tile.left || bottom?.right == tile.right)
          ) {
            availableTilesToPlace.push(tile);
          }
        });
      }

      if (availableTilesToPlace.length > 0) {
        tileToPlace = availableTilesToPlace[0];
        availableTilesToPlace.forEach((tile) => {
          if (tile.left + tile.right < tileToPlace.left + tileToPlace.right) {
            tileToPlace = tile;
          }
        });
      }

      if (tileToPlace) {
        const msg = {
          tile: tileToPlace,
          sisterTile: null,
          roomId,
          tableId,
          playerMode,
          gameMode,
          userId: turn,
        };

        const isPlaced = await this.placeTile(currWs, aWss, msg);
        if (isPlaced) {
          await this.sendNewScene(
            currWs,
            aWss,
            roomId,
            tableId,
            playerMode,
            gameMode,
            turn
          );
        }
      }
    } else if (!turnAvailable && market.length != 1) {
      // find tile that can be placed on scene in market and give to user

      let userTiles = JSON.parse(user.tiles);

      // const leftTile = scene[0];
      // const rightTile = scene[scene.length - 1];

      let newScene = scene[Math.floor(scene.length / 2)];
      let leftTile = null;
      let rightTile = null;

      let { top, bottom } = this.findVerticalCorners(scene);
      for (let i = 0; i < newScene.length; i++) {
        if (newScene[i]?.id >= 0 && !leftTile) {
          leftTile = newScene[i];
        }
      }
      for (let i = newScene.length - 1; i >= 0; i--) {
        if (newScene[i]?.id >= 0 && !rightTile) {
          rightTile = newScene[i];
        }
      }

      let tileToPlace = null;

      const availableTilesToPlace = [];

      market.forEach((tile) => {
        if (tile.left == leftTile.left || tile.right == leftTile.left) {
          availableTilesToPlace.push(tile);
        }
        if (tile.left == rightTile.right || tile.right == rightTile.right) {
          availableTilesToPlace.push(tile);
        }
        if (top && (top?.left == tile.left || top?.left == tile.right)) {
          availableTilesToPlace.push(tile);
        }
        if (
          bottom &&
          (bottom?.right == tile.left || bottom?.right == tile.right)
        ) {
          availableTilesToPlace.push(tile);
        }
      });

      tileToPlace = availableTilesToPlace[0];

      if (!tileToPlace) {
        return;
      }

      // delete tile from market and give to user
      userTiles.push(tileToPlace);
      market.splice(market.indexOf(tileToPlace), 1);

      // give user also few random tiles from market and delete them there

      let randomAmount = Math.floor(Math.random() * 5) + 1;

      for (let i = 0; i < randomAmount; i++) {
        if (market.length > 0) {
          let newUserTile = market[0];
          userTiles.push(newUserTile);
          market.splice(0, 1);
        }
      }

      await DominoGame.update(
        { market: JSON.stringify(market) },
        { where: { id: dominoGame.id } }
      );
      await DominoGamePlayer.update(
        { tiles: JSON.stringify(userTiles) },
        { where: { userId: turn } }
      );
      dominoGame = await DominoGame.findOne({
        where: {
          roomId,
          tableId,
          playerMode,
          gameMode,
        },
        include: DominoGamePlayer,
      });

      const msg = {
        tile: tileToPlace,
        sisterTile: null,
        roomId,
        tableId,
        playerMode,
        gameMode,
        userId: turn,
      };

      if (currWs) {
        currWs.send(
          JSON.stringify({
            method: "getMarketTile",
            tile: tileToPlace,
            dominoRoomId: roomId,
            tableId,
            playerMode,
            gameMode,
            turn: turn,
            scene: JSON.parse(dominoGame.scene),
            turnAvailable: true,
            closeMarket: true,
          })
        );
      }

      // обновляем пользователю инвентарь доминошек
      if (currWs) {
        currWs.send(
          JSON.stringify({
            method: "updateUserTiles",
            tiles: userTiles,
            turn: turn,
            scene: JSON.parse(dominoGame.scene),
            dominoRoomId: roomId,
            tableId,
            playerMode,
            gameMode,
          })
        );
      }

      // обновляем количество доминошек в базаре
      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        {
          method: "updateMarketNumber",
          marketNumber: market.length,
          player: turn,
        }
      );

      // отправляем новую сцену пользователям
      const isPlaced = await this.placeTile(currWs, aWss, msg);
      if (isPlaced) {
        await this.sendNewScene(
          currWs,
          aWss,
          roomId,
          tableId,
          playerMode,
          gameMode,
          turn
        );
      }
    }
    dominoGame = await DominoGame.findOne({
      where: {
        roomId,
        tableId,
        playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const playerTilesData = [];
    for (const player of dominoGame.dominoGamePlayers) {
      if (player.userId == turn) {
        playerTilesData.push({
          userId: player.userId,
          tilesNumber: JSON.parse(player.tiles).length,
        });
      }
    }

    // отправляем всем пользователям сколько у кого доминошек осталось
    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      {
        playerTilesData,
        roomId,
        tableId,
        playerMode,
        gameMode,
        method: "updateEnemysTilesCount",
      }
    );

    const playersTiles = dominoGame.dominoGamePlayers.map((player) => {
      return { userId: player.userId, tiles: JSON.parse(player.tiles) };
    });

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      {
        playersTiles,
        method: "updateEnemysTilesMarket",
      }
    );
  }

  async sendNewScene(
    ws,
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    turn = null,
    dominoGameBase = null
  ) {
    let userId = null;
    let username = null;

    if (ws && ws.userId && ws.username) {
      userId = ws.userId;
      username = ws.username;
    }

    if (dominoGameBase) {
      dominoGameBase.dominoGamePlayers.forEach((player) => {
        if (player.userId == turn) {
          userId = player.userId;
          username = player.username;
        }
      });

      let message = {
        method: "updateDominoGameScene",
        scene: JSON.parse(dominoGameBase.scene),
        player: { username: username, userId: userId },
      };

      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        message
      );
      return;
    }

    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    if (!userId || !username) {
      dominoGame.dominoGamePlayers.forEach((player) => {
        if (player.userId == turn) {
          userId = player.userId;
          username = player.username;
        }
      });
    }

    const scene = JSON.parse(dominoGame.scene);
    let message = {
      method: "updateDominoGameScene",
      scene: scene,
      player: { username: username, userId: userId },
    };

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      message
    );
  }

  async giveMarketTile(ws, aWss, userId, startTurn) {
    let roomId = ws.dominoRoomId;
    let tableId = ws.tableId;
    let playerMode = ws.playerMode;
    let gameMode = ws.gameMode;

    let dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const scene = JSON.parse(dominoGame.scene);
    const market = JSON.parse(dominoGame.market);
    let newUserTile = null;
    const user = dominoGame.dominoGamePlayers.find(
      (player) => player.userId == userId
    );
    const userTiles = JSON.parse(user.tiles);

    // if (market.length > 1) {
    if (market.length > 1) {
      newUserTile = market[0];
      userTiles.push(newUserTile);
      market.splice(0, 1);
    }

    await DominoGame.update(
      { market: JSON.stringify(market) },
      { where: { id: dominoGame.id } }
    );
    await DominoGamePlayer.update(
      { tiles: JSON.stringify(userTiles) },
      { where: { userId: userId } }
    );

    dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const playerTilesData = [];
    for (const player of dominoGame.dominoGamePlayers) {
      if (player.userId == userId) {
        playerTilesData.push({
          userId: player.userId,
          tilesNumber: JSON.parse(player.tiles).length,
        });
      }
    }

    // отправляем всем пользователям сколько у кого доминошек осталось
    let message = {
      playerTilesData,
      roomId,
      tableId,
      playerMode,
      gameMode,
      method: "updateEnemysTilesCount",
    };

    const playersTiles = dominoGame.dominoGamePlayers.map((player) => {
      return { userId: player.userId, tiles: JSON.parse(player.tiles) };
    });

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      {
        playersTiles,
        method: "updateEnemysTilesMarket",
      }
    );

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      message
    );

    let turnAvailable = this.isTurnAvailable(userTiles, scene, gameMode, user);
    let closeMarket = false;

    if (turnAvailable) {
      closeMarket = true;
    }

    // if (JSON.parse(dominoGame.market).length == 0) {
    if (JSON.parse(dominoGame.market).length == 1) {
      closeMarket = true;
    }

    ws.send(
      JSON.stringify({
        method: "getMarketTile",
        tile: newUserTile,
        dominoRoomId: roomId,
        tableId: tableId,
        playerMode: playerMode,
        gameMode,
        turn: +dominoGame.turn,
        scene: JSON.parse(dominoGame.scene),
        turnAvailable: turnAvailable,
        closeMarket: closeMarket,
      })
    );

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      {
        method: "updateMarketNumber",
        marketNumber: market.length,
        player: userId,
      }
    );

    // тут
    // if (JSON.parse(dominoGame.market).length ==0 && !turnAvailable) {
    if (
      (JSON.parse(dominoGame.market).length == 0 && !turnAvailable) ||
      (JSON.parse(dominoGame.market).length == 1 && !turnAvailable)
    ) {
      await startTurn(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        null,
        null,
        true,
        true,
        false
      );
    }

    return;
  }

  async checkAvailableTurn(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    currentTurn,
    dominoGame,
    startTurn = null
  ) {
    // get the game scene and market
    const scene = JSON.parse(dominoGame.scene);
    const market = JSON.parse(dominoGame.market);

    // get the players in the room
    // console.log(dominoGame);
    const playersInRoom = dominoGame.dominoGamePlayers;

    // get the current turn user
    const user = playersInRoom.find((player) => player.userId == currentTurn);
    if (!user) {
      return;
    }
    let availableTurn = this.isTurnAvailable(
      JSON.parse(user.tiles),
      scene,
      gameMode
    );
    // if (market.length > 0 && !availableTurn) {
    if (market.length > 1 && !availableTurn) {
      for (const client of aWss.clients) {
        if (
          client.userId == user.userId &&
          client.dominoRoomId == roomId &&
          client.tableId == tableId &&
          client.playerMode == playerMode &&
          client.gameMode == gameMode
        ) {
          client.send(
            JSON.stringify({ method: "openTileMarket", market: market })
          );
        }
      }
    } else if (
      (market.length == 1 && !availableTurn && startTurn) ||
      (market.length == 0 && !availableTurn && startTurn)
    ) {
      setTimeout(async () => {
        await startTurn(
          aWss,
          roomId,
          tableId,
          playerMode,
          gameMode,
          null,
          null,
          true,
          true,
          false
        );
      }, 1500);
    }

    return;
  }

  isTurnAvailable(userTiles, scene, gameMode = "CLASSIC", user = null) {
    let isTurnAvailable = false;

    // get the user tiles
    // console.log(user);

    if (typeof userTiles == "string") {
      userTiles = JSON.parse(userTiles);
    }

    if (gameMode == "CLASSIC") {
      let tilesAmount = this.countTiles(scene);

      // pick the central row
      scene = scene[Math.floor(scene.length / 2)];

      // check the user tiles
      if (userTiles.length > 0) {
        if (tilesAmount == 0) {
          // console.log("turn available because of 0 scene");
          return true;
        }
        userTiles.forEach((tile) => {
          // check if the user tiles match the scene
          // find left tile on scene

          let leftTile = null;
          let rightTile = null;
          for (let i = 0; i < scene.length; i++) {
            if (scene[i]?.id >= 0 && !leftTile) {
              leftTile = scene[i];
            }
          }
          for (let i = scene.length - 1; i >= 0; i--) {
            if (scene[i]?.id >= 0 && !rightTile) {
              rightTile = scene[i];
            }
          }

          // console.log("pastTile", leftTile, rightTile);

          if (tile.left == leftTile?.left || tile.right == leftTile?.left) {
            // console.log(tile, "^ available");
            isTurnAvailable = true;
          }
          if (tile.left == rightTile?.right || tile.right == rightTile?.right) {
            // console.log(tile, "^ available");

            isTurnAvailable = true;
          }
        });
      }

      // console.log("isTurnAvailable", isTurnAvailable);
      return isTurnAvailable;
    } else {
      // check for all available tiles
      const areVerticalsFilled = this.checkIfVerticalsFilled(scene);

      if (!areVerticalsFilled) {
        // same logic as classic domino but check for available doubles
        const availableDoubles = [];

        let tilesAmount = this.countTiles(scene);

        scene = scene[Math.floor(scene.length / 2)];
        const allDoubles = scene.filter((tile) => tile.left == tile.right);
        allDoubles.forEach((tile) => {
          // check if on the right and left of double there are tiles
          if (tile.id >= 0 && tile.central == true) {
            availableDoubles.push(tile);
          }
        });

        if (userTiles.length > 0) {
          if (tilesAmount == 0) {
            // console.log("turn available because of 0 scene");
            return true;
          }
          userTiles.forEach((tile) => {
            let leftTile = null;
            let rightTile = null;

            for (let i = 0; i < scene.length; i++) {
              if (scene[i]?.id >= 0 && !leftTile) {
                leftTile = scene[i];
              }
            }

            for (let i = scene.length - 1; i >= 0; i--) {
              if (scene[i]?.id >= 0 && !rightTile) {
                rightTile = scene[i];
              }
            }

            availableDoubles.forEach((doubleTile) => {
              if (
                tile.left == doubleTile?.left ||
                tile.right == doubleTile?.left
              ) {
                // console.log(tile, "^ available to this", doubleTile);

                isTurnAvailable = true;
              }
            });

            if (tile.left == leftTile?.left || tile.right == leftTile?.left) {
              // console.log(tile, "^ available");
              isTurnAvailable = true;
            }

            if (
              tile.left == rightTile?.right ||
              tile.right == rightTile?.right
            ) {
              // console.log(tile, "^ available");

              isTurnAvailable = true;
            }
          });
        }
        return isTurnAvailable;
      } else {
        // when there are verticals, check all 4 corners
        const { top, bottom } = this.findVerticalCorners(scene);

        let tilesAmount = this.countTiles(scene);

        let newScene = scene[Math.floor(scene.length / 2)];

        if (userTiles.length > 0) {
          if (tilesAmount == 0) {
            // console.log("turn available because of 0 scene");
            return true;
          }
          userTiles.forEach((tile) => {
            let leftTile = null;
            let rightTile = null;

            for (let i = 0; i < newScene.length; i++) {
              if (newScene[i]?.id >= 0 && !leftTile) {
                leftTile = newScene[i];
              }
            }

            for (let i = newScene.length - 1; i >= 0; i--) {
              if (newScene[i]?.id >= 0 && !rightTile) {
                rightTile = newScene[i];
              }
            }

            if (tile.left == leftTile?.left || tile.right == leftTile?.left) {
              // console.log(tile, "^ available");
              isTurnAvailable = true;
            }

            if (
              tile.left == rightTile?.right ||
              tile.right == rightTile?.right
            ) {
              isTurnAvailable = true;
            }

            if (tile.left == top?.left || tile.right == top?.left) {
              isTurnAvailable = true;
            }

            if (tile.left == bottom?.right || tile.right == bottom?.right) {
              isTurnAvailable = true;
            }
          });
        }
        return isTurnAvailable;
      }
    }
  }

  findVerticalCorners(scene) {
    // take middle row
    let verticalIndex = null;

    scene.forEach((row, i) => {
      if (i != Math.floor(scene.length / 2)) {
        row.forEach((tile, j) => {
          if (tile?.id >= 0) {
            verticalIndex = row.indexOf(tile);
          }
        });
      }
    });

    let top = null;
    let bottom = null;
    // find first and last element in rows with index verticalIndex
    scene.forEach((row) => {
      if (row[verticalIndex]?.id >= 0) {
        if (top === null) {
          top = row[verticalIndex];
        }
        bottom = row[verticalIndex];
      }
    });

    return { top, bottom };
  }

  checkIfVerticalsFilled(scene) {
    // take middle row
    let middleRow = scene[Math.floor(scene.length / 2)];
    // check if any other row has tiles
    let areVerticalsFilled = false;
    scene.forEach((row) => {
      if (row != middleRow) {
        row.forEach((tile) => {
          if (tile?.id >= 0) {
            areVerticalsFilled = true;
          }
        });
      }
    });
    return areVerticalsFilled;
  }

  async checkWin(aWss, roomId, tableId, playerMode, gameMode, startTurn) {
    // classic domino
    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const usersData = await User.findAll();

    const playersInRoom = dominoGame.dominoGamePlayers;
    let scene = JSON.parse(dominoGame.scene);
    const market = JSON.parse(dominoGame.market);
    let winners = [];

    // check if someone won
    playersInRoom.forEach((player) => {
      if (JSON.parse(player.tiles).length == 0) {
        winners = [
          {
            userId: player.userId,
            username: usersData.find((user) => user.id == player.userId)
              .username,
          },
        ];
      }
    });

    const playersScore = [];
    // если никого не нашли с 0 доминошек в инвентаре
    if (winners.length == 0) {
      // check if someone can make a turn
      let isTurnAvailable = false;
      playersInRoom.forEach((player) => {
        if (
          this.isTurnAvailable(player.tiles, scene, gameMode) &&
          !isTurnAvailable
        ) {
          isTurnAvailable = true;
        }
      });

      if (market.length <= 1 && !isTurnAvailable) {
        // ищем победителя по очкам

        // find score for each player
        playersInRoom.forEach((player) => {
          let score = 0;
          JSON.parse(player.tiles).forEach((tile) => {
            score += tile.left + tile.right;
          });
          playersScore.push({
            userId: player.userId,
            score: score,
          });
        });

        // find the winner (player with lowest score)

        let lowestScore = 1000;

        playersScore.forEach((player) => {
          if (player.score < lowestScore) {
            lowestScore = player.score;
          }
        });

        // find all players with lowest score

        playersScore.forEach((player) => {
          if (player.score == lowestScore) {
            winners.push({
              userId: player.userId,
              username: usersData.find((user) => user.id == player.userId)
                .username,
            });
          }
        });
      }
    }

    // заканчиваем игру если режим класики
    if (winners.length > 0 && gameMode == "CLASSIC") {
      await this.endClassicDominoGame(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        winners,
        dominoGame,
        scene,
        usersData
      );
      return true;
    }

    if (gameMode == "TELEPHONE" && winners.length < 1) {
      for (const player of playersInRoom) {
        if (player.points >= 165) {
          winners.push({
            userId: player.userId,
            username: usersData.find((user) => user.id == player.userId)
              .username,
          });
        }

        if (winners.length > 0) {
          await this.endClassicDominoGame(
            aWss,
            roomId,
            tableId,
            playerMode,
            gameMode,
            winners,
            dominoGame,
            scene,
            usersData
          );
          return true;
        }
      }
    }

    //  продолжаем или заканчиваем игру если режим телефон
    if (winners.length > 0 && gameMode == "TELEPHONE") {
      let continueStatus = await this.checkEndTelephoneDominoGame(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        winners
      );

      if (!continueStatus.isGameEnded) {
        // отправить что конец игры, показать попап кто залутал поинты -> через 5-10 секунд отправить перезапуск игры
        await this.continueTelephoneDominoGame(
          aWss,
          roomId,
          tableId,
          playerMode,
          gameMode,
          continueStatus.lastWinnerId,
          startTurn,
          continueStatus.lastWinnerScore,
          continueStatus.playerScore,
          continueStatus.lastWinnerPrevScore,
          usersData
        );
        return true;
      } else if (continueStatus.isGameEnded) {
        await this.endClassicDominoGame(
          aWss,
          roomId,
          tableId,
          playerMode,
          gameMode,
          winners,
          dominoGame,
          scene,
          usersData
        );
        return true;
      }
    }
    return false;
  }
  async endClassicDominoGame(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    winners,
    dominoGame,
    scene,
    usersData
  ) {
    const betInfo = this.getDominoRoomBetInfo(roomId);
    const prize =
      ((betInfo.bet - betInfo.commission) * playerMode) / winners.length;

    // refresh database record
    dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    // send message only to winners
    aWss.clients.forEach((client) => {
      if (
        winners.map((winner) => winner.userId).includes(client.userId) &&
        client.dominoRoomId == roomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        client.send(
          JSON.stringify({
            method: "winDominoGame",
            winners: winners,
            prize,
            bet: betInfo.bet,
            playersTiles: dominoGame.dominoGamePlayers.map((player) => {
              return {
                userId: player.userId,
                username: usersData.find((user) => user.id == player.userId)
                  .username,
                tiles: JSON.parse(player.tiles),
                score: player.points,
              };
            }),
          })
        );
      }
    });

    // send message to all who lost
    aWss.clients.forEach((client) => {
      if (
        !winners.map((winner) => winner.userId).includes(client.userId) &&
        client.dominoRoomId == roomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        client.send(
          JSON.stringify({
            method: "endDominoGame",
            winners: winners,
            lostAmount: betInfo.bet,
            playersTiles: dominoGame.dominoGamePlayers.map((player) => {
              return {
                userId: player.userId,
                username: usersData.find((user) => user.id == player.userId)
                  .username,
                tiles: JSON.parse(player.tiles),
                score: player.points,
              };
            }),
          })
        );
      }
    });

    // update db records
    // обновляем что игра завершилась и ожидает сброса
    await DominoGame.update(
      {
        isFinished: true,
      },
      { where: { id: dominoGame.id } }
    );

    setTimeout(async () => {
      const playersInRoom = dominoGame.dominoGamePlayers;

      aWss.clients.forEach((client) => {
        if (
          client.dominoRoomId == roomId &&
          client.tableId == tableId &&
          client.playerMode == playerMode &&
          client.gameMode == gameMode
        ) {
          client.send(
            JSON.stringify({ method: "endAndCloseDominoGame", prize, gameMode })
          );

          client.dominoRoomId == null;
          client.tableId == null;
          client.playerMode == null;
          client.gameMode == null;
        }
      });

      // update winners balance
      winners.forEach(async (winner) => {
        const winnerUser = await User.findOne({
          where: { id: winner.userId },
        });
        await winnerUser.update({
          balance: winnerUser.balance + prize,
        });
      });

      // update stats for each player
      playersInRoom.forEach(async (player) => {
        await Stats.update(
          {
            gameDominoPlayed: literal(`gameDominoPlayed + 1`),
            moneyDominoLost: literal(
              `moneyDominoLost + ${
                winners.map((winner) => winner.userId).includes(player.userId)
                  ? 0
                  : betInfo.bet
              }`
            ),
            moneyDominoWon: literal(
              `moneyDominoWon + ${
                winners.map((winner) => winner.userId).includes(player.userId)
                  ? prize - betInfo.bet
                  : 0
              }`
            ),
            dominoTokens: literal(`dominoTokens + ${betInfo.tokens}`),
          },
          { where: { userId: player.userId } }
        );
        await DominoUserGame.create({
          userId: player.userId,
          isWinner: winners
            .map((winner) => winner.userId)
            .includes(player.userId),
          winSum: winners.map((winner) => winner.userId).includes(player.userId)
            ? prize - betInfo.bet
            : 0,
          scene,
          roomId,
          tableId,
          playerMode,
          gameMode,
        });
      });

      await DominoGamePlayer.destroy({
        where: { dominoGameId: dominoGame.id },
      });

      let emptyScene = createEmptyScene();
      await DominoGame.update(
        {
          startedAt: null,
          isStarted: false,
          turn: null,
          turnQueue: "[]",
          scene: JSON.stringify(emptyScene),
          market: "[]",
          isFinished: false,
          continued: false,
        },
        { where: { id: dominoGame.id } }
      );

      await this.getAllDominoInfo(null, aWss);
    }, 15000);
  }

  async checkEndTelephoneDominoGame(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    winners
  ) {
    let dominoGame = await DominoGame.findOne({
      where: {
        tableId,
        roomId,
        playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const allUsers = await User.findAll();

    // посчитать количество очков по доминошкам у людей в конце игры
    let players = dominoGame.dominoGamePlayers;
    let playerScore = countPlayersPoints(players, allUsers);

    // найти игрока с меньшим кол-вом из playersScore
    const minPlayer = playerScore.reduce((prev, curr) =>
      prev.score < curr.score ? prev : curr
    );

    // отдать ему все очки
    let allPoints =
      playerScore.reduce((prev, curr) => prev + curr.score, 0) -
      minPlayer.score;

    // округляем очки которые даем победившему человеку
    // 0 - 4 = 5
    // 11-14 = 15
    // 16-19 = 20

    if (allPoints % 5 != 0) {
      allPoints = Math.ceil(allPoints / 5) * 5;
    }

    const newPoints = (players.find(
      (player) => player.userId == minPlayer.userId
    ).points += allPoints);
    await DominoGamePlayer.update(
      { points: newPoints },
      { where: { userId: minPlayer.userId } }
    );

    // обновляем даные в базе
    dominoGame = await DominoGame.findOne({
      where: {
        tableId,
        roomId,
        playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });
    players = dominoGame.dominoGamePlayers;

    // проверяем есть ли у когото больше 165 очков
    const winnerCandidates = players.filter((player) => player.points >= 165);
    // find winner from winnerCandidates with max points
    let winner = null;
    if (winnerCandidates.length > 0) {
      winner = winnerCandidates.reduce((prev, curr) =>
        prev.points > curr.points ? prev : curr
      );
    }

    // если есть игрок с единственной доминошкой 0/0, начислить 10 очков победителю
    // ищем всех с 1 доминошкой
    const playersWithOneTile = players.filter(
      (player) => JSON.parse(player.tiles).length == 1
    );

    // ищем того у кого 0/0
    const playerWithZeroZero = playersWithOneTile.find(
      (player) =>
        JSON.parse(player.tiles)[0].left == 0 &&
        JSON.parse(player.tiles)[0].right == 0
    );

    // начисляем 10 очков победителю
    if (playerWithZeroZero && winner) {
      const newPoints = (players.find(
        (player) => player.userId == winner.userId
      ).points += 10);
      await DominoGamePlayer.update(
        { points: newPoints },
        { where: { userId: winner.userId } }
      );
    }

    if (winner) {
      return { isGameEnded: true, winner };
    } else {
      return {
        isGameEnded: false,
        lastWinnerId: minPlayer.userId,
        lastWinnerPrevScore: minPlayer.score,
        lastWinnerScore: minPlayer.score + allPoints,
        playerScore: playerScore,
      };
    }
  }

  async continueTelephoneDominoGame(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    turn,
    startTurn,
    lastWinnerScore,
    playersScore,
    lastWinnerPrevScore,
    usersData
  ) {
    let dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    let pastRoundDominoGame = dominoGame;

    let playersInRoom = dominoGame.dominoGamePlayers;

    let turnQueue = [turn];
    playersInRoom.forEach((player) => {
      if (player.userId != turn) {
        turnQueue.push(player.userId);
      }
    });
    // shuffle without first element
    turnQueue = shuffle(turnQueue.slice(1));
    turnQueue.unshift(turn);

    // делаем доминошки и сортируем по пользователям
    const { playersTiles, marketTiles } = generateAndSortTiles(
      dominoGame.dominoGamePlayers,
      dominoGame.playerMode,
      turnQueue,
      dominoGame.gameMode
    );

    const emptyScene = createEmptyScene();
    await DominoGame.update(
      {
        isStarted: true,
        turnQueue: JSON.stringify(turnQueue),
        scene: JSON.stringify(emptyScene),
        continued: true,
      },
      { where: { id: dominoGame.id } }
    );

    // создаем базар
    await createMarketInRoom(
      tableId,
      roomId,
      playerMode,
      gameMode,
      marketTiles
    );

    await createPlayersTiles(aWss, {}, playersTiles, dominoGame);

    let gameMessage = {
      tableId,
      dominoRoomId: roomId,
      playerMode,
      gameMode,
    };

    dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    playersInRoom = dominoGame.dominoGamePlayers;

    const allUsers = await User.findAll();
    const usersInThisTable = [];
    playersInRoom.forEach((player) => {
      const userInfo = allUsers.find((user) => user.id == player.userId);
      usersInThisTable.push({
        score: player.points,
        username: userInfo.username,
        userId: player.userId,
        avatar: userInfo.avatar,
        tiles: JSON.parse(player.tiles),
      });
    });

    // 4 5 3 1
    // 3
    // 3 1 4 5

    gameMessage.players = usersInThisTable;
    gameMessage.market = marketTiles;
    gameMessage.turnQueue = JSON.parse(dominoGame.turnQueue);
    gameMessage.turn = turn;
    gameMessage.continued = dominoGame.continued;
    gameMessage.turnTime = 0;
    gameMessage.scene = emptyScene;
    gameMessage.method = "startDominoGameTable";

    const lastWinnerUsername = allUsers.find(
      (user) => user.id == turn
    ).username;

    let currentRoomClients = [];
    aWss.clients.forEach((client) => {
      if (
        client.dominoRoomId == roomId &&
        client.tableId == tableId &&
        client.playerMode == playerMode &&
        client.gameMode == gameMode
      ) {
        currentRoomClients.push(client);
      }
    });

    // message for popup on round finish and then start new round after delay
    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      {
        method: "finishTelephoneRound",
        lastWinnerScore,
        lastWinnerId: turn,
        lastWinnerUsername,
        lastWinnerPrevScore,
        playersScore,
        playersTiles: pastRoundDominoGame.dominoGamePlayers.map((player) => {
          return {
            userId: player.userId,
            username: usersData.find((user) => user.id == player.userId)
              .username,
            tiles: JSON.parse(player.tiles),
            score: player.points,
          };
        }),
      }
    );

    playersInRoom = await DominoGamePlayer.findAll({
      where: {
        dominoGameId: dominoGame.id,
      },
    });

    const scores = playersInRoom.map((player) => player.points);
    let maxScore = 0;
    maxScore = Math.max(...scores);

    aWss.clients.forEach((client) => {
      client.send(
        JSON.stringify({
          method: "updateTableScore",
          roomId,
          tableId,
          playerMode,
          gameMode,
          points: maxScore,
        })
      );
    });

    let date = await axios.get(
      "https://timeapi.io/api/Time/current/zone?timeZone=Europe/London",
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    const turnTime = new Date(date.data.dateTime).getTime();

    setTimeout(async () => {
      gameMessage.turnTime = turnTime + 5000;

      // начало новой очереди игры
      await startTurn(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        turn,
        turnTime + 5000
      );

      roomsFunctions.sendToClientsInTable(
        aWss,
        roomId,
        tableId,
        playerMode,
        gameMode,
        gameMessage
      );
    }, 5000);
  }

  async sendAllTableInfo(
    ws,
    roomId,
    tableId,
    playerMode,
    gameMode,
    clearScene = false
  ) {
    // find all info about game
    const dominoGame = await DominoGame.findOne({
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
      include: DominoGamePlayer,
    });

    const playersInRoom = dominoGame.dominoGamePlayers;
    const usersData = await User.findAll();

    // console.log(usersData);

    // write usernames to playersInRoom
    playersInRoom.forEach((player) => {
      // add username to player
      player.dataValues.username = usersData.find(
        (user) => user.id == player.userId
      ).username;
      player.dataValues.score = player.points;
      player.dataValues.avatar = usersData.find(
        (user) => user.id == player.userId
      ).avatar;
    });

    // find user tiles

    const userTiles = JSON.parse(
      playersInRoom.find((player) => player.userId == ws.userId).tiles
    );

    const message = {
      method: "reconnectDominoGame",
      scene: JSON.parse(dominoGame.scene),
      market: JSON.parse(dominoGame.market),
      turnQueue: JSON.parse(dominoGame.turnQueue),
      turn: +dominoGame.turn,
      turnTime: dominoGame.turnTime,
      players: playersInRoom,
      playersTiles: playersInRoom.map((player) => {
        return { userId: player.userId, tiles: JSON.parse(player.tiles) };
      }),
      userTiles,
      roomId,
      tableId,
      playerMode,
      gameMode,
      continued: dominoGame.continued,
      clearScene,
      user: usersData.find((user) => user.id == ws.userId),
    };

    ws.send(JSON.stringify(message));
  }

  sendEmoji(aWss, roomId, tableId, playerMode, gameMode, emojiId, userId) {
    const message = {
      method: "sendEmoji",
      emojiId,
      userId,
    };

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      message
    );
  }

  sendPhrase(aWss, roomId, tableId, playerMode, gameMode, phraseId, userId) {
    const message = {
      method: "sendPhrase",
      phraseId,
      userId,
    };

    roomsFunctions.sendToClientsInTable(
      aWss,
      roomId,
      tableId,
      playerMode,
      gameMode,
      message
    );
  }

  getDominoRoomBetInfo(roomId) {
    switch (roomId) {
      case 1:
        return {
          bet: 0.5,
          commission: 0.075,
          tokens: 2,
        };
      case 2:
        return {
          bet: 1,
          commission: 0.15,
          tokens: 5,
        };
      case 3:
        return {
          bet: 3,
          commission: 0.45,
          tokens: 15,
        };
      case 4:
        return {
          bet: 5,
          commission: 0.75,
          tokens: 25,
        };
      case 5:
        return {
          bet: 10,
          commission: 1.5,
          tokens: 50,
        };
    }
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
}
module.exports = new dominoGameService();

function createEmptyScene() {
  const scene = [];
  for (let i = 0; i < 57; i++) {
    const row = [];
    for (let j = 0; j < 57; j++) {
      row.push({});
    }
    scene.push(row);
  }
  return scene;
}

function countPlayersPoints(players, allUsers = null) {
  const playerScore = [];
  players.forEach((player) => {
    let score = 0;

    //check count
    let playerTilesInventory = JSON.parse(player.tiles);
    if (
      playerTilesInventory.length == 1 &&
      playerTilesInventory[0].left == 0 &&
      playerTilesInventory[0].right == 0
    ) {
      score += 10;
    }
    playerTilesInventory.forEach((tile) => {
      score += tile.left + tile.right;
    });

    // // сделать score кратным 5, округлив до большого

    // if (score % 5 != 0) {
    //   score = Math.ceil(score / 5) * 5;
    // }

    playerScore.push({
      userId: player.userId,
      score: score,
      username: allUsers
        ? allUsers.find((user) => user.id == player.userId).username
        : null,
    });
  });

  return playerScore;
}

async function deleteUserInventoryTile(
  ws,
  aWss,
  tile,
  roomId,
  tableId,
  playerMode,
  gameMode,
  userId
) {
  // const userId = ws.userId;
  let dominoGame = await DominoGame.findOne({
    where: {
      tableId: tableId,
      roomId: roomId,
      playerMode: playerMode,
      gameMode,
    },
    include: DominoGamePlayer,
  });
  // console.log(userId);

  const user = dominoGame.dominoGamePlayers.find(
    (player) => player.userId == +userId
  );
  // console.log(user);
  const userTiles = JSON.parse(user.tiles);
  const deletedTile = userTiles.find((userTile) => +userTile.id == +tile.id);

  userTiles.splice(userTiles.indexOf(deletedTile), 1);

  // отправляем пользователю что удалили у него доминошку

  if (ws) {
    ws.send(
      JSON.stringify({
        method: "deleteInventoryTile",
        deletedTileId: deletedTile.id,
        tiles: JSON.stringify(userTiles),
      })
    );
  }

  const usersInThisTable = [];
  for (const client of aWss.clients) {
    if (
      client.roomId == roomId &&
      client.tableId == tableId &&
      client.playerMode == playerMode &&
      client.gameMode == gameMode
    ) {
      usersInThisTable.push({
        userId: client.userId,
        username: client.username,
      });
    }
  }

  await DominoGamePlayer.update(
    { tiles: JSON.stringify(userTiles) },
    { where: { userId: userId, dominoGameId: dominoGame.id } }
  );

  dominoGame = await DominoGame.findOne({
    where: {
      tableId: tableId,
      roomId: roomId,
      playerMode: playerMode,
      gameMode: gameMode,
    },
    include: DominoGamePlayer,
  });

  const playerTilesData = [];
  for (const player of dominoGame.dominoGamePlayers) {
    if (player.userId == userId) {
      playerTilesData.push({
        userId: player.userId,
        tilesNumber: JSON.parse(player.tiles).length,
      });
    }
  }

  // отправляем всем пользователям сколько у кого доминошек осталось
  let message = {
    playerTilesData,
    roomId,
    tableId,
    playerMode,
    gameMode,
    method: "updateEnemysTilesCount",
  };

  roomsFunctions.sendToClientsInTable(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    message
  );

  const playersTiles = dominoGame.dominoGamePlayers.map((player) => {
    return { userId: player.userId, tiles: JSON.parse(player.tiles) };
  });

  roomsFunctions.sendToClientsInTable(
    aWss,
    roomId,
    tableId,
    playerMode,
    gameMode,
    {
      playersTiles,
      method: "updateEnemysTilesMarket",
    }
  );
}

async function addTileToTop(tile, bottomTile, dominoGame, scene, inversed) {
  const topTileCoords = findTileOnScene(scene, bottomTile);
  // console.log("bottomTile", bottomTile);
  // console.log("topTileCoords", topTileCoords);
  // console.log(tile, bottomTile, "top and tile when true");

  // place tile above

  if (bottomTile.rotate) {
    if (inversed) {
      scene[topTileCoords.row - 1][topTileCoords.index] = {
        left: tile.right,
        right: tile.left,
        id: tile.id,
        rotate: false,
      };
    } else {
      scene[topTileCoords.row - 1][topTileCoords.index] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: false,
      };
    }
  } else {
    if (tile.left == tile.right) {
      scene[topTileCoords.row - 1][topTileCoords.index] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: true,
      };
    } else {
      if (inversed) {
        scene[topTileCoords.row - 1][topTileCoords.index] = {
          left: tile.right,
          right: tile.left,
          id: tile.id,
          rotate: false,
        };

        // console.log("TOP-2", scene[Math.floor(scene.length / 2) - 3]);
        // console.log("TOP-1", scene[Math.floor(scene.length / 2) - 2]);
        // console.log("TOP", scene[Math.floor(scene.length / 2) - 1]);
        // console.log("MIDDLE", scene[Math.floor(scene.length / 2)]);
        // console.log("BOTTOM", scene[Math.floor(scene.length / 2) + 1]);
      } else {
        scene[topTileCoords.row - 1][topTileCoords.index] = {
          left: tile.left,
          right: tile.right,
          id: tile.id,
          rotate: false,
        };
        //   console.log("TOP-2", scene[Math.floor(scene.length / 2) - 3]);
        //   console.log("TOP-1", scene[Math.floor(scene.length / 2) - 2]);
        //   console.log("TOP", scene[Math.floor(scene.length / 2) - 1]);
        //   console.log("MIDDLE", scene[Math.floor(scene.length / 2)]);
        //   console.log("BOTTOM", scene[Math.floor(scene.length / 2) + 1]);
      }
    }
  }

  await DominoGame.update(
    { scene: JSON.stringify(scene) },
    { where: { id: dominoGame.id } }
  );
}

async function addTileToBottom(tile, topTile, dominoGame, scene, inversed) {
  const bottomTileCoords = findTileOnScene(scene, topTile);
  // console.log(tile, topTile, "bottom and tile when true");

  // place tile below

  if (topTile.rotate) {
    if (inversed) {
      scene[bottomTileCoords.row + 1][bottomTileCoords.index] = {
        left: tile.right,
        right: tile.left,
        id: tile.id,
        rotate: false,
      };
    } else {
      scene[bottomTileCoords.row + 1][bottomTileCoords.index] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: false,
      };
    }
  } else {
    if (tile.left == tile.right) {
      scene[bottomTileCoords.row + 1][bottomTileCoords.index] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: true,
      };
    } else {
      if (inversed) {
        scene[bottomTileCoords.row + 1][bottomTileCoords.index] = {
          left: tile.right,
          right: tile.left,
          id: tile.id,
          rotate: false,
        };
      } else {
        scene[bottomTileCoords.row + 1][bottomTileCoords.index] = {
          left: tile.left,
          right: tile.right,
          id: tile.id,
          rotate: false,
        };
      }
    }
  }

  await DominoGame.update(
    { scene: JSON.stringify(scene) },
    { where: { id: dominoGame.id } }
  );
}

async function addTileToLeft(
  tile,
  leftTile,
  dominoGame,
  scene,
  inversed,
  position = "row"
) {
  const leftTileCoords = findTileOnScene(scene, leftTile);
  // console.log(tile);

  // console.log("addTileToLeft", leftTile, leftTileCoords);

  if (leftTile.rotate) {
    if (inversed) {
      scene[leftTileCoords.row][leftTileCoords.index - 1] = {
        left: tile.right,
        right: tile.left,
        id: tile.id,
        rotate: false,
      };
    } else {
      scene[leftTileCoords.row][leftTileCoords.index - 1] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: false,
      };
    }
  } else {
    if (tile.left == tile.right) {
      scene[leftTileCoords.row][leftTileCoords.index - 1] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: true,
      };
    } else {
      if (inversed) {
        scene[leftTileCoords.row][leftTileCoords.index - 1] = {
          left: tile.right,
          right: tile.left,
          id: tile.id,
          rotate: false,
        };
      } else {
        scene[leftTileCoords.row][leftTileCoords.index - 1] = {
          left: tile.left,
          right: tile.right,
          id: tile.id,
          rotate: false,
        };
      }
    }
  }

  // ищем центральный елемент
  let centralTileCandidate = null;
  scene[Math.floor(scene.length / 2)].forEach((tile) => {
    if (tile.id >= 0 && tile.central == true) {
      centralTileCandidate = tile;
    }
  });

  if (!centralTileCandidate) {
    let doubleTiles = [];
    let availableDouble = null;
    let newScene = scene[Math.floor(scene.length / 2)];

    newScene.forEach((tile) => {
      if (tile?.left == tile?.right && tile?.id >= 0) {
        doubleTiles.push(tile);
      }
    });

    doubleTiles.forEach((tile) => {
      const leftTile = newScene[newScene.indexOf(tile) - 1];
      const rightTile = newScene[newScene.indexOf(tile) + 1];
      if (leftTile && rightTile && leftTile?.id >= 0 && rightTile?.id >= 0) {
        availableDouble = tile;
      }
    });

    if (availableDouble) {
      scene[Math.floor(scene.length / 2)].find(
        (tile) => tile.id == availableDouble.id
      ).central = true;
    }
  }

  await DominoGame.update(
    { scene: JSON.stringify(scene) },
    { where: { id: dominoGame.id } }
  );
}

async function addTileToRight(
  tile,
  rightTile,
  dominoGame,
  scene,
  inversed,
  position = "row"
) {
  const rightTileCoords = findTileOnScene(scene, rightTile);
  // console.log(tile);
  // console.log("addTileToRight", rightTile, rightTileCoords);

  if (rightTile.rotate) {
    if (inversed) {
      scene[rightTileCoords.row][rightTileCoords.index + 1] = {
        left: tile.right,
        right: tile.left,
        id: tile.id,
        rotate: false,
      };
    } else {
      scene[rightTileCoords.row][rightTileCoords.index + 1] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: false,
      };
    }
  } else {
    if (tile.left == tile.right) {
      scene[rightTileCoords.row][rightTileCoords.index + 1] = {
        left: tile.left,
        right: tile.right,
        id: tile.id,
        rotate: true,
      };
    } else {
      if (inversed) {
        scene[rightTileCoords.row][rightTileCoords.index + 1] = {
          left: tile.right,
          right: tile.left,
          id: tile.id,
          rotate: false,
        };
      } else {
        scene[rightTileCoords.row][rightTileCoords.index + 1] = {
          left: tile.left,
          right: tile.right,
          id: tile.id,
          rotate: false,
        };
      }
    }
  }

  // console.log("newScene", scene[14]);

  // ищем центральный елемент
  let centralTileCandidate = null;
  scene[Math.floor(scene.length / 2)].forEach((tile) => {
    if (tile.id >= 0 && tile.central == true) {
      centralTileCandidate = tile;
    }
  });

  if (!centralTileCandidate) {
    let doubleTiles = [];
    let availableDouble = null;
    let newScene = scene[Math.floor(scene.length / 2)];

    newScene.forEach((tile) => {
      if (tile?.left == tile?.right && tile?.id >= 0) {
        doubleTiles.push(tile);
      }
    });

    doubleTiles.forEach((tile) => {
      const leftTile = newScene[newScene.indexOf(tile) - 1];
      const rightTile = newScene[newScene.indexOf(tile) + 1];
      if (leftTile && rightTile && leftTile?.id >= 0 && rightTile?.id >= 0) {
        availableDouble = tile;
      }
    });

    if (availableDouble) {
      scene[Math.floor(scene.length / 2)].find(
        (tile) => tile.id == availableDouble.id
      ).central = true;
    }
  }

  await DominoGame.update(
    { scene: JSON.stringify(scene) },
    { where: { id: dominoGame.id } }
  );
}

function findTileOnScene(scene, tile) {
  let rowNumber = -1;
  let index = -1;

  scene.forEach((row) => {
    row.forEach((sceneTile) => {
      if (sceneTile.id == tile.id) {
        rowNumber = scene.indexOf(row);
        index = row.indexOf(sceneTile);
      }
    });
  });

  return { row: rowNumber, index };
}

function generateAndSortTiles(
  players,
  playerMode,
  turnQueue,
  gameMode = "CLASSIC"
) {
  // console.log(players);
  // make 28 domino tiles
  let tiles = [];
  let doubleTiles = [];
  let id = 0;
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      if (i == j) {
        doubleTiles.push({ left: i, right: j, id });
      } else {
        tiles.push({ left: i, right: j, id });
      }
      id++;
    }
  }

  let playersTiles = [];
  let marketTiles = [];

  tiles = shuffle(tiles);

  if (playerMode == 2) {
    // shuffle 14 tiles between 2 players
    const randomDouble1 =
      doubleTiles[Math.floor(Math.random() * doubleTiles.length)];
    playersTiles.push({
      isFirst: false,
      tiles: tiles.slice(0, 6),
      userId: players[0].userId,
    });
    playersTiles[0].tiles.push(randomDouble1);

    let temp = randomDouble1.left;
    let randomDouble2 =
      doubleTiles[Math.floor(Math.random() * doubleTiles.length)];

    // make sure that second player has different double tile
    if (temp == randomDouble2.left) {
      while (temp == randomDouble2.left) {
        randomDouble2 =
          doubleTiles[Math.floor(Math.random() * doubleTiles.length)];
      }
    }

    playersTiles.push({
      isFirst: false,
      tiles: tiles.slice(6, 12),
      userId: players[1].userId,
    });

    playersTiles[1].tiles.push(randomDouble2);

    doubleTiles.splice(doubleTiles.indexOf(randomDouble1), 1);
    doubleTiles.splice(doubleTiles.indexOf(randomDouble2), 1);

    doubleTiles.forEach((tile) => {
      tiles.push(tile);
    });
    marketTiles = tiles.slice(12, 26);
  } else if (playerMode == 4) {
    // shuffle 7 tiles between 4 players
    for (let i = 0; i < 4; i++) {
      // make each player have a double tile and 6 random tiles
      const randomDouble =
        doubleTiles[Math.floor(Math.random() * doubleTiles.length)];
      // check if one of the players already has this double tile
      let isDoubleAlreadyExists = false;
      playersTiles.forEach((playerTiles) => {
        playerTiles.tiles.forEach((tile) => {
          if (
            tile.left == randomDouble.left &&
            tile.right == randomDouble.right
          )
            isDoubleAlreadyExists = true;
        });
      });
      if (isDoubleAlreadyExists) {
        i--;
        continue;
      }
      playersTiles.push({
        isFirst: false,
        tiles: [randomDouble],
        userId: players[i].userId,
      });
      doubleTiles.splice(doubleTiles.indexOf(randomDouble), 1);
    }

    doubleTiles.forEach((tile) => {
      tiles.push(tile);
    });

    for (let i = 0; i < 6; i++) {
      playersTiles.forEach((playerTiles) => {
        playerTiles.tiles.push(tiles.pop());
      });
    }
  }

  // if (!isDouble) {
  //   return generateAndSortTiles(playerMode);
  // }

  // find lowest double
  let lowestDouble = 7;
  playersTiles.forEach((playerTiles) => {
    playerTiles.tiles.forEach((tile) => {
      if (
        tile.left == tile.right &&
        tile.left < lowestDouble &&
        tile.left != 0
      ) {
        lowestDouble = tile.left;
      }
    });
  });

  // find player with lowest double and make him first
  playersTiles.forEach((playerTiles) => {
    playerTiles.tiles.forEach((tile) => {
      if (tile.left == tile.right && tile.left == lowestDouble) {
        playerTiles.isFirst = true;
      }
    });
  });

  // check if player has double 0 and no other doubles, make this player not first and random player first
  let playerWithZero = null;
  playersTiles.forEach((playerTiles) => {
    playerTiles.tiles.forEach((tile) => {
      if (tile.left == 0 && tile.right == 0) {
        playerWithZero = playerTiles;
      }
    });
  });

  if (playerWithZero != null) {
    let isDouble = false;
    playerWithZero.tiles.forEach((tile) => {
      if (tile.left == tile.right) {
        isDouble = true;
      }
    });
    if (!isDouble) {
      playerWithZero.isFirst = false;
      // pick random player that is not playerWithZero and make him first
      let randomPlayer = null;
      playersTiles.forEach((playerTiles) => {
        if (playerTiles.userId != playerWithZero.userId) {
          randomPlayer = playerTiles;
        }
      });
      randomPlayer.isFirst = true;
    }
  }

  if (gameMode == "TELEPHONE") {
    // find player who has tile 2 3 and if there is such player, make him first and all other players not first
    let playerWith23 = null;
    playersTiles.forEach((playerTiles) => {
      playerTiles.tiles.forEach((tile) => {
        if (
          (tile.left == 2 && tile.right == 3) ||
          (tile.left == 3 && tile.right == 2)
        ) {
          playerWith23 = playerTiles;
        }
      });
    });
    // console.log(playerWith23, "игроки с 2/3");
    if (playerWith23 != null) {
      playersTiles.forEach((playerTiles, i) => {
        playerTiles.isFirst = false;
        if (playerTiles.userId == playerWith23.userId) {
          playerTiles.isFirst = true;
          // console.log(playerTiles.userId, "айдишник");
        }
      });
    }
  }

  // check if any player has more than 4 tiles with same value on one of sides (like 4-0; 4-1; 4-2; 4-5; 4-6)
  let playerWithMoreThan4 = null;
  playersTiles.forEach((playerTiles) => {
    playerTiles.tiles.forEach((tile) => {
      let countLeft = 0;
      let countRight = 0;
      playerTiles.tiles.forEach((playerTile) => {
        if (playerTile.left == tile.left || playerTile.right == tile.left) {
          countLeft++;
        }

        if (playerTile.left == tile.right || playerTile.right == tile.right) {
          countRight++;
        }
      });
      // console.log(tile, "count: ", countLeft, countRight);
      if (countLeft > 4 || countRight > 4) {
        playerWithMoreThan4 = playerTiles;
      }
    });
  });

  if (playerWithMoreThan4 != null) {
    return generateAndSortTiles(players, playerMode, turnQueue, gameMode);
  }

  marketTiles = shuffle(marketTiles);

  return { playersTiles, marketTiles };
}

function shuffle(array) {
  // shuffle array
  let currentIndex = array.length,
    randomIndex;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
}

async function createMarketInRoom(
  tableId,
  roomId,
  playerMode,
  gameMode,
  marketTiles
) {
  await DominoGame.update(
    { market: JSON.stringify(marketTiles) },
    {
      where: {
        tableId: tableId,
        roomId: roomId,
        playerMode: playerMode,
        gameMode,
      },
    }
  );
}
// playersTiles приходят с правильным порядком игроков, но функция запихивает их в базу в неправильном порядке
async function createPlayersTiles(aWss, msg, playersTiles, dominoGame) {
  const playersInRoom = await DominoGamePlayer.findAll({
    where: {
      dominoGameId: dominoGame.id,
    },
  });
  // console.log(playersTiles);
  for (const player of playersInRoom) {
    await DominoGamePlayer.update(
      {
        tiles: JSON.stringify(
          playersTiles.find(
            (playerTiles) => playerTiles.userId == player.userId
          ).tiles
        ),
      },
      {
        where: {
          dominoGameId: dominoGame.id,
          userId: player.userId,
        },
      }
    );
  }
  await DominoGame.update(
    {
      turn: playersTiles.find((playerTiles) => playerTiles.isFirst == true)
        .userId,
    },
    {
      where: {
        id: dominoGame.id,
      },
    }
  );
}
