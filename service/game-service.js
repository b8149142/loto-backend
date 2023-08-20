const {
  Loto,
  User,
  LotoCard,
  LotoGame,
  LotoSetting,
  Stats,
  BotStats,
  UserGame,
} = require("../models/db-models");
const lotoAdminService = require("./loto-admin-service");
const roomsFunctions = require("./loto-rooms-functions");
const { literal } = require("sequelize");

class GameService {
  async startLotoGame(ws, aWss, msg) {
    try {
      const game = await LotoGame.findOne({ where: { gameLevel: msg.roomId } });
      const players = await checkLotoPlayers(ws, aWss, msg);
      // получаем все даные с комисси в текущей комнате
      let roomComminsionInfo = roomsFunctions.getRoomCommisionInfo(msg.roomId);
      // проверка если ботов и игроков 0 то заканчиваем игру
      if (players < 1 && game.bots < 1) {
        // await lotoAdminService.deleteBots(ws, aWss, msg.roomId);
        await LotoGame.update(
          {
            finishesAt: null,
            isStarted: false,
            isWaiting: false,
            startedAt: null,
            bots: 0,
            botsTickets: "[]",
          },
          { where: { gameLevel: msg.roomId } }
        );

        return;
      }

      // проверка если игроков 0 и в комнате только боты то начинаем фальш игру для ботов
      if (players < 1 && game.bots > 0) {
        let botsTicketsNum = 0;
        let botsTicketsArr = JSON.parse(game.botsTickets);
        botsTicketsArr.forEach((ticket) => {
          botsTicketsNum += Number(ticket);
        });

        const botBank = botsTicketsNum * roomComminsionInfo.bet;
        await LotoGame.update(
          {
            finishesAt: new Date().getTime() + 76 * 1000 + 15000,
            isStarted: true,
          },
          { where: { gameLevel: msg.roomId } }
        );
        // отправляем сообщение о начале игры на сервер
        await getAllRoomsFinishTimers(aWss);
        setTimeout(async () => {
          await LotoGame.update(
            {
              finishesAt: null,
              isStarted: false,
              isWaiting: false,
              startedAt: null,
              bots: 0,
              botsTickets: "[]",
              prevBank: botBank,
            },
            { where: { gameLevel: msg.roomId } }
          );

          let prevBank = await roomsFunctions.getAllPrevBets();
          roomsFunctions.sendAll(aWss, "updateAllRoomsPrevBank", {
            prevBank: prevBank,
          });
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
          roomsFunctions.sendAll(aWss, "updateAllRoomsBank", {
            bank: roomsBet,
          });
        }, 76 * 1000 + 15000);
        return;
      }

      // получаем настройки комнаты и шансы бота на выиграш
      const settings = await LotoSetting.findOne({
        where: { gameLevel: msg.roomId },
      });

      const botChance = +settings.winChance / 100;

      // проверяем выиграл ли бот в комнате
      let isBotWon = Math.random() <= botChance;

      // создаем порядок выпадения бочек с номерами в игре
      const casks = generateCasks();

      // получаем все билеты для комнаты
      const lotoCards = await LotoCard.findAll({
        where: { gameLevel: msg.roomId },
      });

      let lotoCardsArray = [];
      lotoCards.forEach((lotoCard) => {
        let lotoCardInfo = {};
        (lotoCardInfo.id = lotoCard.id),
          (lotoCardInfo.card = JSON.parse(lotoCard.card));
        lotoCardsArray.push(lotoCardInfo);
      });

      // ищем айди номеров в карточке у каждой карточки
      let indexesArray = [];

      lotoCardsArray.forEach((lotoCard) => {
        let cellsArrayIds = [];
        let indexesNumbersArray = {};

        for (let i = 0; i < lotoCard.card.length; i++) {
          if (casks.includes(+lotoCard.card[i])) {
            cellsArrayIds.push(casks.indexOf(+lotoCard.card[i]));
            indexesNumbersArray.id = lotoCard.id;
            indexesNumbersArray.cellsArrayIds = cellsArrayIds;
          }
        }
        indexesArray.push(indexesNumbersArray);
      });

      // сортируем каждый масств индексов в порядке убывания
      indexesArray.forEach((ticketIndexes) => {
        const maxNumbers = ticketIndexes.cellsArrayIds
          .slice()
          .sort((a, b) => b - a)
          .slice(0, 4);

        ticketIndexes.cellsArrayIds = maxNumbers;
      });

      let finalists = {
        winners: { index: 0, tickets: [] },
        left1: [],
        left2: [],
        left3: [],
      };
      // ищем и записываем карточку которая выйграет
      let maximums = [];
      indexesArray.forEach((ticketIndexes) => {
        maximums.push(ticketIndexes.cellsArrayIds[0]);
      });
      let minimum = Math.min(...maximums);
      indexesArray.forEach((ticketIndexes) => {
        if (ticketIndexes.cellsArrayIds[0] === minimum) {
          finalists.winners.tickets.push(ticketIndexes.id);
        }
      });
      finalists.winners.index = minimum;

      let botWinnerIndex = 90;

      if (isBotWon) {
        // находим индекс на котором выграл бот
        if (minimum > 25) {
          botWinnerIndex = minimum - (Math.round(Math.random() * 7) + 1);
        } else {
          botWinnerIndex = 16;
        }
        finalists.winners.index = botWinnerIndex;
        finalists.winners.tickets = [];

        // получаем статистику ботов (в какой комнате выиграли)
        const botStat = await BotStats.findOne({ where: { id: 1 } });
        let lotoRoomWins = JSON.parse(botStat.lotoRoomWins);
        lotoRoomWins[`room${msg.roomId}`] += 1;
        await BotStats.update(
          {
            lotoRoomWins: JSON.stringify(lotoRoomWins),
          },
          { where: { id: 1 } }
        );
      }

      // получаем количество выигравших билетов
      let amountOfWinnerTickets = finalists.winners.tickets.length;
      if (amountOfWinnerTickets == 0) {
        amountOfWinnerTickets = 1;
      }

      // добавляем в finalists left рандомно индексы, которые меньше от индекса победителя. в left1 - 1-2 индекса, в left2 - 1-3 индекса, в left3 1-4 индекса
      for (let i = 1; i <= 3; i++) {
        let iterationAmount;
        switch (i) {
          case 1:
            iterationAmount = Math.round(Math.random()) + 1;
            for (let k = 0; k < iterationAmount; k++) {
              const randomIndex = Math.floor(
                finalists.winners.index - i * 3 * Math.random()
              );
              finalists[`left${i}`].push(randomIndex);
            }
            break;
          case 2:
            iterationAmount = Math.round(Math.random()) + 2;
            for (let k = 0; k < iterationAmount; k++) {
              const randomIndex = Math.floor(
                finalists.winners.index - i * 3 * Math.random()
              );
              finalists[`left${i}`].push(randomIndex);
            }
            break;
          case 3:
            iterationAmount = Math.round(Math.random()) + 3;
            for (let k = 0; k < iterationAmount; k++) {
              const randomIndex = Math.floor(
                finalists.winners.index - i * 3 * Math.random()
              );
              finalists[`left${i}`].push(randomIndex);
            }
            break;
        }
      }

      console.log(finalists);

      // добавляем в базу информацию когда текущая игра заканчивается.
      await LotoGame.update(
        {
          finishesAt: new Date().getTime() + minimum * 1000 + 15000,
          isStarted: true,
        },
        { where: { gameLevel: msg.roomId } }
      );

      // добавляем в массив финалистов карточки которые могут выигать через несколько ходов

      for (let i = 1; i <= 3; i++) {
        indexesArray.forEach((ticketIndexes) => {
          if (ticketIndexes.cellsArrayIds[i] < finalists.winners.index) {
            finalists[`left${i}`].push(ticketIndexes.cellsArrayIds[i]);
          }
        });
      }

      // отправляем месседж о начале игры

      let roomOnline = 0;
      aWss.clients.forEach((client) => {
        if (client.roomId == msg.roomId) {
          roomOnline++;
        }
      });

      roomOnline += game.bots;

      // отправляем сообщение о начале игры на сервер
      await getAllRoomsFinishTimers(aWss);

      let botsTicketsNum = 0;
      let botsTicketsArr = JSON.parse(game.botsTickets);

      botsTicketsArr.forEach((ticket) => {
        botsTicketsNum += Number(ticket);
      });

      for (const client of aWss.clients) {
        if (client.roomId == msg.roomId) {
          let openGameMsg = {
            bet: roomComminsionInfo.fullBet,
            online: roomOnline,
            bank: (lotoCards.length + botsTicketsNum) * roomComminsionInfo.bet,
            method: "openGame",
            jackpot:
              roomComminsionInfo.jackpotPart *
              (lotoCards.length + botsTicketsNum),
            roomId: msg.roomId,
          };
          client.send(JSON.stringify(openGameMsg));
        }
      }

      // записываем статистику боту
      const botStat = await BotStats.findOne({ where: { id: 1 } });
      await BotStats.update(
        {
          moneyLotoWon:
            botStat.moneyLotoWon +
            (isBotWon ? lotoCards.length * roomComminsionInfo.bet : 0),
          moneyLotoLost:
            botStat.moneyLotoLost + botsTicketsNum * roomComminsionInfo.bet,
        },
        { where: { id: botStat.id } }
      );

      // делаем онлайн выдачу карточек и расчет времени игры
      await giveCasksOnline(
        ws,
        aWss,
        msg.roomId,
        casks,
        finalists,
        (lotoCards.length + botsTicketsNum) * roomComminsionInfo.bet,
        amountOfWinnerTickets,
        botsTicketsNum,
        roomComminsionInfo.bet,
        roomComminsionInfo.fullBet
      );
    } catch (error) {
      console.log(error);
    }
  }

  async createCards(ws, msg) {
    try {
      let userId = msg.userId;
      let tickets = msg.tickets;

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

  async gameBuyTickets(ws, msg) {
    try {
      let roomComminsionInfo = roomsFunctions.getRoomCommisionInfo(msg.roomId);

      let tickets = msg.tickets;
      const user = await User.findOne({ where: { id: msg.userId } });
      // check if user has enough money
      if (user.balance < tickets.length * roomComminsionInfo.fullBet) {
        return false;
      }

      const newBalance =
        user.balance - tickets.length * roomComminsionInfo.fullBet;

      // update user balance
      await User.update({ balance: newBalance }, { where: { id: msg.userId } });

      ws.send(
        JSON.stringify({
          method: "updateBalance",
          balance: newBalance,
        })
      );

      for (let i = 0; i < tickets.length; i++) {
        await LotoCard.create({
          id: tickets[i].ticketId,
          userId: msg.userId,
          card: JSON.stringify(tickets[i].ticketCells),
          gameLevel: msg.roomId,
        });
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkBet(ws, aWss, msg) {
    let roomComminsionInfo = roomsFunctions.getRoomCommisionInfo(msg.roomId);

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
          method: "updateBank",
          bank: (cardsInRoom.length + botsTicketsNum) * roomComminsionInfo.bet,
        };
        client.send(JSON.stringify(message));
      }
    }
  }
}

module.exports = new GameService();

async function giveCasksOnline(
  ws,
  aWss,
  roomId,
  casks,
  finalists,
  bank,
  amountOfWinnerTickets,
  botsTicketsNum,
  bet,
  fullBet
) {
  let winnerCaskId = finalists.winners.index;
  let left1Ids = finalists.left1;
  let left2Ids = finalists.left2;
  let left3Ids = finalists.left3;

  let tokens = roomsFunctions.getRoomCommisionInfo(roomId).tokens;

  await sendCasksWithDelay(casks, winnerCaskId, roomId);
  async function sendCasksWithDelay(casks, winnerCaskId, roomId) {
    let index = 0;
    let pastCasks = [];
    let left3Cask = 0;
    let left2Cask = 0;
    let left1Cask = 0;
    let isJackpotWon = false;
    const jackpotCheckLimit = 25;

    const allTickets = await LotoCard.findAll({
      where: { gameLevel: roomId },
    });
    const allUsers = await User.findAll();

    async function sendNextCask() {
      if (index < casks.length) {
        const cask = casks[index];
        let caskMessage = {
          method: "sendNewCask",
          cask: cask,
          pastCasks: pastCasks,
          caskNumber: index + 1,
        };
        pastCasks.push(cask);
        broadcastGame(aWss, roomId, caskMessage);

        // проверка на джекпот
        if (pastCasks.length < jackpotCheckLimit) {
          if (!isJackpotWon) {
            const jackpotWinner = checkJackpotWon(allTickets, pastCasks);
            if (jackpotWinner) {
              isJackpotWon = true;
              await handleJackpotWin(roomId, jackpotWinner, allUsers, aWss);
            }
          }
        }

        // проверка на победителя
        if (casks.indexOf(cask) === winnerCaskId) {
          let winMessage = {
            method: "winGame",
            winners: finalists.winners.tickets,
            bank: bank,
            winnersAmount: amountOfWinnerTickets,
            isJackpotWon,
          };

          // обновление баланса и статистики

          let winnerTickets = [];

          allTickets.forEach((ticket) => {
            if (finalists.winners.tickets.includes(ticket.id)) {
              winnerTickets.push(ticket);
            }
          });

          // получаем суму выиграша для 1 юзера в зависимости от количества билетов
          let userWinSum = bank / winnerTickets.length;
          let userIds = [];

          // даем каждому пользователю токены

          const usersInRoom = allUsers.filter((user) =>
            allTickets.find((ticket) => ticket.userId == user.id)
          );
          const usersIdsInRoom = usersInRoom.map((user) => user.id);

          await Stats.update(
            {
              lotoTokens: literal(`lotoTokens + ${tokens}`),
            },
            { where: { userId: usersIdsInRoom } }
          );

          // делаем масив пользователей и каждому записываем свою суму выигриша

          let userObjects = [];

          for (const ticket of winnerTickets) {
            for (const user of allUsers) {
              if (user.id == ticket.userId) {
                let userCandidate = userObjects.find(
                  (userObject) => userObject.user == user.id
                );
                if (userCandidate) {
                  userCandidate.winSum += userWinSum;
                } else {
                  userIds.push(user.id);
                  userObjects.push({
                    user: user.id,
                    winSum: userWinSum,
                    loseSum: 0,
                  });
                }
              }
            }
          }

          // перебираем весь масив с победителями и добавляем им баланс и статистику
          const stats = await Stats.findAll();

          for (const userObject of userObjects) {
            for (const stat of stats) {
              if (userIds.includes(stat.userId)) {
                if (stat.userId == userObject.user) {
                  await Stats.update(
                    {
                      moneyLotoWon:
                        stat.moneyLotoWon +
                        userObject.winSum -
                        bet *
                          allTickets.filter(
                            (ticket) => ticket.userId == userObject.user
                          ).length,
                      gameLotoPlayed: stat.gameLotoPlayed + 1,
                    },
                    { where: { userId: userObject.user } }
                  );
                  await User.update(
                    {
                      balance:
                        allUsers.find((user) => user.id == userObject.user)
                          .balance + userObject.winSum,
                    },
                    { where: { id: userObject.user } }
                  );

                  const userTickets = allTickets.filter(
                    (ticket) => ticket.userId == userObject.user
                  );
                  await UserGame.create({
                    userId: userObject.user,
                    tickets: JSON.stringify(userTickets),
                    casks: JSON.stringify(pastCasks),
                    winSum: userObject.winSum,
                    isWinner: true,
                    winIndex: pastCasks.length,
                    bet: fullBet,
                    bank,
                    isJackpotWon,
                  });

                  // присылаем всем победителям сообщение о выиграше

                  for (const client of aWss.clients) {
                    if (client.userId == userObject.user) {
                      client.send(
                        JSON.stringify({
                          method: "updateBalance",
                          balance:
                            allUsers.find((user) => user.id == userObject.user)
                              .balance + userObject.winSum,
                        })
                      );
                    }
                  }
                }
              }
            }
          }

          // обновляем статистику всем проигравшим, добавляем в статистику проигрыш и количество игр
          for (const user of allUsers) {
            if (!userIds.includes(user.id)) {
              await Stats.update(
                {
                  moneyLotoLost:
                    stats.find((stat) => stat.userId == user.id).moneyLotoLost +
                    bet *
                      allTickets.filter((ticket) => ticket.userId == user.id)
                        .length,
                  gameLotoPlayed:
                    stats.find((stat) => stat.userId == user.id)
                      .gameLotoPlayed + 1,
                },
                { where: { userId: user.id } }
              );

              const userTickets = allTickets.filter(
                (ticket) => ticket.userId == user.id
              );
              await UserGame.create({
                userId: user.id,
                tickets: JSON.stringify(userTickets),
                casks: JSON.stringify(pastCasks),
                winSum: 0,
                isWinner: false,
                winIndex: pastCasks.length,
                bet: fullBet,
                bank,
                isJackpotWon,
              });
            }
          }

          // отправка сообщения на клиент
          broadcastGame(aWss, roomId, winMessage);
          // сбросить информацию о комнате
          await LotoGame.update(
            {
              isWaiting: false,
              bots: 0,
              botsTickets: "[]",
            },
            { where: { gameLevel: roomId } }
          );
          await LotoCard.destroy({ where: { gameLevel: roomId } });
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
          roomsFunctions.sendAll(aWss, "updateAllRoomsBank", {
            bank: roomsBet,
          });
          setTimeout(async () => {
            // удалить все сокеты которые остались
            for (const client of aWss.clients) {
              if (client.roomId == roomId) {
                client.close();
              }
            }
            await LotoGame.update(
              {
                finishesAt: null,
                isStarted: false,
                isWaiting: false,
                startedAt: null,
                bots: 0,
                botsTickets: "[]",
                prevBank: bank,
              },
              { where: { gameLevel: roomId } }
            );

            let prevBank = await roomsFunctions.getAllPrevBets();
            roomsFunctions.sendAll(aWss, "updateAllRoomsPrevBank", {
              prevBank: prevBank,
            });
          }, 10000);
          return;
        }

        // проверка осталось ли у когото 3 карточки

        // count how much elements of left3Ids are less than casks.indexOf(cask)
        let left1 = left1Ids.filter((id) => +id <= +casks.indexOf(cask)).length;
        let left2 = left2Ids.filter((id) => +id <= +casks.indexOf(cask)).length;
        let left3 = left3Ids.filter((id) => +id <= +casks.indexOf(cask)).length;
        if (left3 > 0 && left2 == 0 && left1 == 0) {
          let leftSomeMessage3 = {
            method: "leftSome",
            type: "left3",
            left3: left3,
            caskIndex: left3Ids
              .filter((id) => id < casks.indexOf(cask))
              .sort((a, b) => a - b)[0],
          };
          broadcastGame(aWss, roomId, leftSomeMessage3);
        }
        // проверка осталось ли у когото 2 карточки
        if (left2 > 0 && left1 == 0) {
          let leftSomeMessage2 = {
            method: "leftSome",
            type: "left2",
            left2,
            caskIndex: left2Ids
              .filter((id) => id < casks.indexOf(cask))
              .sort((a, b) => a - b)[0],
          };
          broadcastGame(aWss, roomId, leftSomeMessage2);
        }

        // проверка осталось ли у когото 1 карточки
        if (left1) {
          let leftSomeMessage1 = {
            method: "leftSome",
            type: "left1",
            left1,
            caskIndex: left1Ids
              .filter((id) => id < casks.indexOf(cask))
              .sort((a, b) => a - b)[0],
          };
          broadcastGame(aWss, roomId, leftSomeMessage1);
        }

        index++;
        setTimeout(sendNextCask, 1000); // 2-second delay
      }
    }

    sendNextCask(); // Start the process
  }
}

function broadcastGame(aWss, roomId, message) {
  for (const client of aWss.clients) {
    if (client.roomId == roomId) {
      client.send(JSON.stringify(message));
    }
  }
}

function checkJackpotWon(tickets, pastCasks) {
  let isJackpotWon = false;
  let jackpotWinner;

  if (!isJackpotWon) {
    for (let ticket of tickets) {
      const card = JSON.parse(ticket.card);
      let rows = [[], [], []];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 9; j++) {
          if (card[i * 9 + j] != " ") {
            rows[i].push(+card[i * 9 + j]);
          }
        }
      }
      // check if any of rows is full
      for (let row of rows) {
        if (row.every((cell) => pastCasks.includes(cell))) {
          isJackpotWon = true;
          jackpotWinner = ticket.userId;
        }
      }
    }
  }
  return jackpotWinner;
}

async function getAllRoomsFinishTimers(aWss) {
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

  const timersMessage = {
    method: "allRoomsFinishTimers",
    timers: roomTimers,
  };
  for (const client of aWss.clients) {
    client.send(JSON.stringify(timersMessage));
  }
}

async function handleJackpotWin(roomId, jackpotWinner, allUsers, aWss) {
  const roomsJackpots = await roomsFunctions.checkAllJackpots();
  const jackpotSum = roomsJackpots[`room${roomId}`];

  // обновляем статистику и баланс победителю
  const winner = allUsers.find((user) => user.id == jackpotWinner);
  await User.update(
    { balance: winner.balance + jackpotSum },
    { where: { id: winner.id } }
  );
  const winnerStats = await Stats.findOne({
    where: { userId: jackpotWinner },
  });
  await Stats.update(
    {
      moneyLotoWon: winnerStats.moneyLotoWon + jackpotSum,
    },
    { where: { userId: jackpotWinner } }
  );

  // рассылаем всем сообщение о выиграше джекпота
  for (const client of aWss.clients) {
    if (client.roomId == roomId) {
      client.send(
        JSON.stringify({
          method: "jackpotWon",
          winner: jackpotWinner,
          sum: jackpotSum,
        })
      );
    }
  }
}

async function checkLotoPlayers(ws, aWss, msg) {
  const roomCards = await LotoCard.findAll({
    where: { gameLevel: msg.roomId },
  });
  let userIdsWithCards = [];
  roomCards.forEach((roomCard) => {
    let userId = roomCard.userId;
    if (!userIdsWithCards.includes(userId)) {
      userIdsWithCards.push(userId);
    }
  });

  for (const client of aWss.clients) {
    if (client.roomId == msg.roomId) {
      if (!userIdsWithCards.includes(client.userId)) {
        let message = {
          method: "didntBoughtTickets",
          roomId: msg.roomId,
        };
        client.send(JSON.stringify(message));
      }
    }
  }

  return userIdsWithCards.length;
}

function generateRandomNumbersWithoutRepeats(min, max, count) {
  if (count > max - min + 1) {
    throw new Error("Can't generate random numbers without repeats");
  }

  let numbers = [];
  while (numbers.length < count) {
    let randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!numbers.includes(randomNumber)) {
      numbers.push(randomNumber);
    }
  }

  return numbers;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generateCasks() {
  const numbersPerRow = 90;
  const minNumber = 1;
  const maxNumber = 90;
  const totalNumbers = 90;

  let lotoCard = [];

  let rowNumbers = generateRandomNumbersWithoutRepeats(
    minNumber,
    maxNumber,
    totalNumbers
  );
  lotoCard.push(rowNumbers);

  for (let i = lotoCard[0].length; i < numbersPerRow; i++) {
    lotoCard[0].push(" ");
  }

  return shuffleArray(lotoCard[0]);
}
