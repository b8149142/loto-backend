const userService = require("../service/user-service");
const { validationResult } = require("express-validator");
const ApiError = require("../exceptions/api-error");
const path = require("path");
const fs = require("fs");
const {
  User,
  BotStats,
  UserGame,
  Stats,
  CurrencyRate,
  Payout,
  Deposit,
  PlayedGame,
  DominoUserGame,
  Page,
  LotoGame,
  DominoGame,
} = require("../models/db-models");
const tokenService = require("../service/token-service");
const Uuid = require("uuid");

class UserController {
  async registration(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(ApiError.BadRequest("ERR_VALIDATION", errors.array()));
      }
      const { username, name, email, password } = req.body;
      const userData = await userService.registrationUser(
        username,
        name,
        email,
        password
      );
      res.cookie("refreshToken", userData.refreshToken, {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
      });
      return res.json(userData);
    } catch (e) {
      next(e);
    }
  }

  async login(req, res, next) {
    try {
      const { username, password } = req.body;
      const userData = await userService.login(username, password);
      res.cookie("refreshToken", userData.refreshToken, {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
      });
      return res.json(userData);
    } catch (e) {
      next(e);
    }
  }

  async uploadAvatar(req, res, next) {
    try {
      let user = await User.findOne({ where: { id: req.user.id } });
      if (!user) {
        throw ApiError.BadRequest("User not found");
      }
      if (user.avatar != null) {
        try {
          fs.unlinkSync(
            `${path.resolve(__dirname, "..", "static", "avatars", user.avatar)}`
          );
        } catch (error) {
          console.log("file not found");
        }
      }
      const file = req.files.file;
      let imageMimeType =
        file.mimetype.split("/")[file.mimetype.split("/").length - 1];
      const avatarName = Uuid.v4() + "." + imageMimeType;
      file.mv(
        `${path.resolve(__dirname, "..", "static", "avatars", avatarName)}`
      );
      await User.update({ avatar: avatarName }, { where: { id: user.id } });
      user = await User.findOne({ where: { id: user.id } });
      return res.json(user);
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  async deleteAvatar(req, res, next) {
    try {
      let user = await User.findOne({ where: { id: req.user.id } });
      if (!user) {
        throw ApiError.BadRequest("User not found");
      }
      fs.unlinkSync(
        `${path.resolve(__dirname, "..", "static", "avatars", user.avatar)}`
      );
      await User.update({ avatar: null }, { where: { id: user.id } });
      user = await User.findOne({ where: { id: user.id } });
      return res.json(user);
    } catch (e) {
      next(e);
    }
  }

  async changePassword(req, res, next) {
    try {
      const { password, newPassword } = req.body;
      const userId = req.user.id;

      let status = await userService.changePassword(
        userId,
        password,
        newPassword
      );
      return res.json(status);
    } catch (e) {
      next(e);
    }
  }

  async logout(req, res, next) {
    try {
      const { refreshToken } = req.cookies;
      // const token = await userService.logout(refreshToken);
      // res.clearCookie("refreshToken");
      return res.json(token);
    } catch (e) {
      next(e);
    }
  }

  async getUser(req, res, next) {
    try {
      const authorizationHeader = req.headers.authorization;
      const accessToken = authorizationHeader.split(" ")[1];
      const userData = tokenService.validateAccessToken(accessToken);
      const user = await User.findOne({ where: { id: userData.id } });
      return res.json(user);
    } catch (e) {
      next(e);
    }
  }

  async checkAuth(req, res, next) {
    try {
      const user = await userService.checkAuth(req, res, next);
      if (!user) {
        throw ApiError.BadRequest("user not found");
      }
      return res.json(user);
    } catch (e) {
      next(e);
    }
  }

  async getLeaders(req, res, next) {
    try {
      let { gameType } = req.params;
      let userId = req.user.id;
      const users = await userService.getLeaders(gameType, userId);
      return res.json(users);
    } catch (e) {
      next(e);
    }
  }

  async getBots(req, res, next) {
    try {
      let { gameType } = req.params;
      const users = await userService.getBots(gameType);

      return res.json(users);
    } catch (e) {
      next(e);
    }
  }

  async getAllUsersStats(req, res, next) {
    try {
      const users = await userService.getAllUsersStats();
      return res.json(users);
    } catch (e) {
      next(e);
    }
  }

  async getUserStats(req, res, next) {
    try {
      const userId = req.user.id;
      const stats = await Stats.findOne({ where: { userId } });
      return res.json(stats);
    } catch (e) {
      next(e);
    }
  }

  async getGames(req, res, next) {
    try {
      const userId = req.user.id;
      const lotoGames = await UserGame.findAll({ where: { userId } });
      const dominoGames = await DominoUserGame.findAll({ where: { userId } });
      return res.json({ lotoGames, dominoGames });
    } catch (e) {
      next(e);
    }
  }

  async getBotWins(req, res, next) {
    try {
      const botStats = await BotStats.findOne({ where: { id: 1 } });
      return res.status(200).json(botStats.lotoRoomWins);
    } catch (e) {
      next(e);
    }
  }

  async exchangeTokens(req, res, next) {
    try {
      const { tokens } = req.body;
      const userId = req.user.id;
      const stats = await Stats.findOne({ where: { userId } });
      const user = await User.findOne({ where: { id: userId } });

      if (tokens > stats.lotoTokensBalance) {
        return res.status(400).json({ message: "ERR_NOT_ENOUGH_TOKENS" });
      }

      if (tokens < 100) {
        return res.status(400).json({ message: "ERR_LESS_100" });
      }

      let addedBalance = 0;
      addedBalance += Math.floor(tokens / 100) / 5;
      const remainder = tokens % 100;

      if (remainder >= 1 && remainder < 10) {
        addedBalance += 0.02;
      } else if (remainder >= 10 && remainder <= 20) {
        addedBalance += 0.04;
      } else if (remainder > 20 && remainder <= 30) {
        addedBalance += 0.05;
      } else if (remainder > 30 && remainder <= 40) {
        addedBalance += 0.06;
      } else if (remainder > 40 && remainder <= 50) {
        addedBalance += 0.1;
      } else if (remainder > 50 && remainder <= 60) {
        addedBalance += 0.13;
      } else if (remainder > 60 && remainder <= 70) {
        addedBalance += 0.14;
      } else if (remainder > 70 && remainder <= 80) {
        addedBalance += 0.15;
      } else if (remainder > 80 && remainder < 100) {
        addedBalance += 0.17;
      }

      await Stats.update(
        { lotoTokensBalance: stats.lotoTokensBalance - tokens },
        { where: { userId } }
      );
      await User.update(
        { balance: user.balance + addedBalance },
        { where: { id: userId } }
      );
      return res.status(200).json({ balance: user.balance + addedBalance });
    } catch (e) {
      next(e);
    }
  }

  async deposit(req, res, next) {
    try {
      const { sum } = req.body;
      const userId = req.user.id;
      const user = await User.findOne({ where: { id: userId } });
      await User.update(
        { balance: user.balance + sum },
        { where: { id: userId } }
      );
      await Deposit.create({ depositAmount: sum, userId: userId });
      const stats = await Stats.findOne({ where: { userId } });
      await stats.update({ deposited: stats.deposited + sum });
      return res.status(200).json({ balance: user.balance + sum });
    } catch (e) {
      next(e);
    }
  }

  async getCurrencyRate(req, res, next) {
    try {
      const currencyRate = await CurrencyRate.findOne({ where: { id: 1 } });
      return res.status(200).json({ rate: currencyRate.rate });
    } catch (e) {
      next(e);
    }
  }

  async createPayout(req, res, next) {
    try {
      const { withdrawAmount, cardNumber, cardHolder, validity } = req.body;
      const userId = req.user.id;
      const user = await User.findOne({ where: { id: userId } });
      if (withdrawAmount > user.balance) {
        return res.status(400).json({ message: "ERR_NOT_ENOUGH_BALANCE" });
      }
      await User.update(
        { balance: user.balance - withdrawAmount },
        { where: { id: userId } }
      );
      await Payout.create({
        withdrawAmount,
        cardNumber,
        cardHolder,
        validity,
        userId,
      });
      return res.status(200).json({ balance: user.balance - withdrawAmount });
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  // const lotoCards = await LotoCard.findAll({
  //   where: { gameLevel: msg.roomId },
  //   include: User,
  // });

  async getPayouts(req, res, next) {
    try {
      const users = await User.findAll({
        include: [Payout, Stats, Deposit],
      });
      let usersWithPayouts = [];
      for (let user of users) {
        if (user.payouts.length > 0 || user.deposits.length > 0) {
          usersWithPayouts.push(user);
        }
      }
      return res.status(200).json(usersWithPayouts);
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  async checkPayouts(req, res, next) {
    try {
      const { ids } = req.body;
      await Payout.update({ checked: true }, { where: { id: ids } });
      return res.status(200).json({ message: "OK" });
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  async getPlayedGames(req, res, next) {
    try {
      const playedGames = await PlayedGame.findAll({
        include: UserGame,
      });

      return res.status(200).json(playedGames);
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  async getPlayedDominoGames(req, res, next) {
    try {
      const playedGames = await DominoUserGame.findAll();
      return res.status(200).json(playedGames);
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  async changeUserData(req, res, next) {
    try {
      const userId = req.user.id;
      const { name, email } = req.body;

      const userCandidate = await User.findOne({ where: { id: userId } });

      const candidateEmail = await User.findOne({ where: { email } });
      if (candidateEmail && candidateEmail.email !== userCandidate.email) {
        throw ApiError.BadRequest(`ERR_EMAIL_ALREADY_EXISTS`);
      }

      await User.update(
        { name: name, email: email },
        { where: { id: userId } }
      );

      return res.json({
        newName: name,
        newEmail: email,
      });
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  async isPageAvailable(req, res, next) {
    try {
      const { page } = req.params;
      const pageData = await Page.findOne({ where: { page } });
      if (!pageData) {
        throw ApiError.BadRequest("Error while finding pages");
      }
      return res.json({ isAvailable: pageData.isAvailable });
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  async getRoomsControl(req, res, next) {
    try {
      const roomsControl = {
        loto: false,
        dominoClassic: false,
        dominoTelephone: false,
        lotoRooms: [],
        dominoClassicRooms: [],
        dominoTelephoneRooms: [],
      };
      const pages = await Page.findAll();
      pages.forEach((page) => {
        roomsControl[page.page] = page.isAvailable;
      });

      const lotoRooms = await LotoGame.findAll();
      const dominoClassicRooms = await DominoGame.findAll({
        where: { gameMode: "CLASSIC" },
      });
      const dominoTelephoneRooms = await DominoGame.findAll({
        where: { gameMode: "TELEPHONE" },
      });

      lotoRooms.forEach((room) => {
        roomsControl.lotoRooms.push({
          roomId: room.gameLevel,
          isAvailable: room.isAvailable,
        });
      });

      dominoClassicRooms.forEach((room) => {
        if (
          !roomsControl.dominoClassicRooms.find((r) => r.roomId == room.roomId)
        ) {
          roomsControl.dominoClassicRooms.push({
            roomId: room.roomId,
            isAvailable: room.isAvailable,
          });
        }
      });

      dominoTelephoneRooms.forEach((room) => {
        if (
          !roomsControl.dominoTelephoneRooms.find((r) => {
            return r.roomId == room.roomId;
          })
        ) {
          roomsControl.dominoTelephoneRooms.push({
            roomId: room.roomId,
            isAvailable: room.isAvailable,
          });
        }
      });

      return res.json(roomsControl);
    } catch (e) {
      console.log(e);
      next(e);
    }
  }

  async updateRoomsControl(req, res, next) {
    // const roomsControl = {
    //   loto: false,
    //   lotoRooms: [],
    // };
    // const roomsControl = {
    //   dominoClassic: false,
    //   dominoClassicRooms: [],
    // };
    // const roomsControl = {
    //   dominoTelephone: false,
    //   dominoTelephoneRooms: [],
    // };

    const { mode } = req.params;
    const roomsControl = req.body;

    try {
      if (mode == "loto") {
        const lotoRooms = await LotoGame.findAll();
        lotoRooms.forEach(async (room) => {
          await room.update({
            isAvailable: roomsControl.lotoRooms.find(
              (r) => r.roomId == room.gameLevel
            ).isAvailable,
          });
        });
        await Page.update(
          { isAvailable: roomsControl.loto },
          { where: { page: "loto" } }
        );
      } else if (mode == "domino-classic") {
        const dominoClassicRooms = await DominoGame.findAll({
          where: { gameMode: "CLASSIC" },
        });

        dominoClassicRooms.forEach(async (room) => {
          await room.update({
            isAvailable: roomsControl.dominoClassicRooms.find(
              (r) => r.roomId == room.roomId
            ).isAvailable,
          });
        });
        await Page.update(
          { isAvailable: roomsControl.dominoClassic },
          { where: { page: "dominoClassic" } }
        );
      } else if (mode == "domino-telephone") {
        const dominoTelephoneRooms = await DominoGame.findAll({
          where: { gameMode: "TELEPHONE" },
        });
        dominoTelephoneRooms.forEach(async (room) => {
          await room.update({
            isAvailable: roomsControl.dominoTelephoneRooms.find(
              (r) => r.roomId == room.roomId
            ).isAvailable,
          });
        });
        await Page.update(
          { isAvailable: roomsControl.dominoTelephone },
          { where: { page: "dominoTelephone" } }
        );
      }
      return res.json(roomsControl);
    } catch (e) {
      console.log(e);
      throw ApiError.BadRequest("Error while updating rooms control");
      next(e);
    }
  }
}

module.exports = new UserController();
