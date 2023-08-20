const userService = require("../service/user-service");
const { validationResult } = require("express-validator");
const ApiError = require("../exceptions/api-error");
const { User, BotStats, UserGame } = require("../models/db-models");
const tokenService = require("../service/token-service");

class UserController {
  async registration(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(ApiError.BadRequest("Validation error", errors.array()));
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
      return res.json(user);
    } catch (e) {
      next(e);
    }
  }

  async getLeaders(req, res, next) {
    try {
      let { gameType } = req.params;
      const users = await userService.getLeaders(gameType);
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

  async getGames(req, res, next) {
    try {
      const userId = req.user.id;
      const games = await UserGame.findAll({ where: { userId } });
      return res.json(games);
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
}

module.exports = new UserController();
