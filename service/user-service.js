const bcrypt = require("bcrypt");
const uuid = require("uuid");
const tokenService = require("./token-service");
const UserDto = require("../dtos/user-dto");
const ApiError = require("../exceptions/api-error");
const {
  User,
  Role,
  Rate,
  Stats,
  BotStats,
  Bot,
  UserGame,
  DominoUserGame,
} = require("../models/db-models");

class UserService {
  async registrationUser(username, name, email, password) {
    const candidateEmail = await User.findOne({ where: { email } });
    if (candidateEmail) {
      throw ApiError.BadRequest(`ERR_EMAIL_ALREADY_EXISTS`);
    }

    const candidateUsername = await User.findOne({ where: { username } });
    if (candidateUsername) {
      throw ApiError.BadRequest("ERR_USERNAME_ALREADY_EXISTS");
    }
    const hashPassword = await bcrypt.hash(password, 3);

    const user = await User.create({
      name: name,
      username: username,
      email: email,
      password: hashPassword,
    });

    // создаем юзера в статистике
    await Stats.create({
      userId: user.id,
    });

    // const stats = await Stats.findAll({ include: User });

    const userDto = new UserDto(user); // id, email, isActivated
    const tokens = tokenService.generateTokens({ ...userDto });
    await tokenService.saveToken(userDto.id, tokens.refreshToken);

    return { ...tokens, user: userDto };
  }

  async login(username, password) {
    const user = await User.findOne({ where: { username: username } });
    if (!user) {
      throw ApiError.BadRequest(
        `Аккаунт с юзернеймом ${username} не существует`
      );
    }
    const isPassEquals = await bcrypt.compare(password, user.password);
    if (!isPassEquals) {
      throw ApiError.BadRequest("Неверный пароль");
    }
    const userDto = new UserDto(user);
    const tokens = tokenService.generateTokens({ ...userDto });

    await tokenService.saveToken(userDto.id, tokens.refreshToken);
    return { ...tokens, user: userDto };
  }

  async logout(refreshToken) {
    const token = await tokenService.removeToken(refreshToken);
    return token;
  }

  async changePassword(userId, oldPassword, newPassword) {
    const user = await User.findOne({ where: { id: userId } });
    const isPassEquals = await bcrypt.compare(oldPassword, user.password);
    if (!isPassEquals) {
      return false;
    }
    const hashPassword = await bcrypt.hash(newPassword, 3);
    await User.update({ password: hashPassword }, { where: { id: userId } });
    return true;
  }

  async checkAuth(req, res, next) {
    const authorizationHeader = req.headers.authorization;
    const accessToken = authorizationHeader.split(" ")[1];
    const userData = tokenService.validateAccessToken(accessToken);
    const user = await User.findOne({ where: { id: userData.id } });
    return user;
  }

  async getLeaders(gameType, userId) {
    let user = await User.findOne({ where: { id: userId } });
    let allStats = await Stats.findAll({ include: User });
    const bots = await Bot.findAll();
    const allUserGames = await UserGame.findAll();

    if (gameType == "loto") {
      //получаем всех юзеров з лото
      let lotoStats = [];
      allStats.forEach((user) => {
        if (user.gameLotoPlayed > 0) {
          const userGames = allUserGames.filter(
            (game) => game.userId == user.userId
          );
          const userWins = userGames.filter(
            (game) => game.isWinner == true
          ).length;
          let userDto = {
            username: user.user.username,
            gamesWon: userWins,
            tokens: user.lotoTokens,
          };
          lotoStats.push(userDto);
        }
      });
      bots.forEach((bot) => {
        if (bot.lotoTokens > 0) {
          let botDto = {
            username: bot.username,
            gamesWon: bot.gameLotoWon,
            tokens: bot.lotoTokens,
          };
          lotoStats.push(botDto);
        }
      });

      // проверка есть ли текущий человек в списке лидеров

      let isUserInArr = false;
      lotoStats.forEach((lotoUserStat) => {
        if (lotoUserStat.username == user.username) {
          isUserInArr = true;
        }
      });
      if (isUserInArr == false) {
        const userGames = allUserGames.filter(
          (game) => game.userId == user.userId
        );
        const userWins = userGames.filter(
          (game) => game.isWinner == true
        ).length;
        let lotoTokens = 0;
        allStats.forEach((userStat) => {
          if (userStat.username == user.username) {
            lotoTokens = userStat.lotoTokens;
          }
        });
        let userDto = {
          username: user.username,
          gamesWon: userWins,
          tokens: lotoTokens,
        };

        lotoStats.push(userDto);
      }

      return lotoStats;
    } else if (gameType == "nards") {
      //получаем всех юзеров з лото
      let nardsStats = [];
      allStats.forEach((user) => {
        if (user.gameNardsPlayed > 0) {
          let userDto = {
            username: user.user.username,
            moneyWon: user.moneyNardsWon,
            tokens: user.nardsTokens,
          };
          nardsStats.push(userDto);
        }
      });
      bots.forEach((bot) => {
        if (bot.gameNardsPlayed > 0) {
          let botDto = {
            username: bot.username,
            moneyWon: bot.moneyNardsWon,
            tokens: bot.nardsTokens,
          };
          nardsStats.push(botDto);
        }
      });
      return nardsStats;
    } else if (gameType == "domino") {
      let dominoStats = [];
      const dominoUserGames = await DominoUserGame.findAll();
      allStats.forEach((user) => {
        if (user.gameDominoPlayed > 0) {
          let userDto = {
            username: user.user.username,
            gamesWon: dominoUserGames.filter(
              (game) => game.userId == user.userId && game.isWinner == true
            ).length,
            tokens: user.dominoTokens,
          };
          dominoStats.push(userDto);
        }
      });
      return dominoStats;
    }
  }

  async getBots(gameType) {
    let allStats = await BotStats.findAll();

    if (gameType == "loto") {
      //получаем всех юзеров з лото
      let lotoStats = [];
      allStats.forEach((bot) => {
        let botDto = {
          moneyWon: bot.moneyLotoWon,
          moneyLost: bot.moneyLotoLost,
        };
        lotoStats.push(botDto);
      });
      return lotoStats;
    } else if (gameType == "nards") {
      //получаем всех юзеров з лото
      let nardsStats = [];
      allStats.forEach((bot) => {
        let botDto = {
          moneyWon: bot.moneyNardsWon,
          moneyLost: bot.moneyNardsLost,
        };
        nardsStats.push(botDto);
      });
      return nardsStats;
    } else if (gameType == "domino") {
      //получаем всех юзеров з лото
      let dominoStats = [];
      allStats.forEach((bot) => {
        let botDto = {
          moneyWon: bot.moneyDominoWon,
          moneyLost: bot.moneyDominoLost,
        };
        nardsStats.push(botDto);
      });
      return dominoStats;
    } else {
      throw ApiError.BadRequest(`Такого типа игры не существует!`);
    }
  }

  async getAllUsersStats() {
    let allStats = await Stats.findAll({ include: User });
    //получаем всех юзеров по одному
    let usersStats = [];
    allStats.forEach((user) => {
      let userDto = {
        username: user.user.username,
        lotoWon: user.moneyLotoWon,
        lotoLost: user.moneyLotoLost,
        nardsWon: user.moneyNardsWon,
        nardsLost: user.moneyNardsLost,
        dominoWon: user.moneyDominoWon,
        dominoLost: user.moneyDominoLost,
        moneyWon: user.moneyLotoWon + user.moneyDominoWon + user.moneyNardsWon,
        moneyLost:
          user.moneyLotoLost + user.moneyDominoLost + user.moneyNardsLost,
      };
      usersStats.push(userDto);
    });
    return usersStats;
  }

  // async refresh(refreshToken) {
  //   if (!refreshToken) {
  //     throw ApiError.UnauthorizedError();
  //   }
  //   const userData = tokenService.validateRefreshToken(refreshToken);
  //   const tokenFromDb = await tokenService.findToken(refreshToken);
  //   if (!userData || !tokenFromDb) {
  //     throw ApiError.UnauthorizedError();
  //   }
  //   const user = await User.findById(userData.id);
  //   const userDto = new UserDto(user);
  //   const tokens = tokenService.generateTokens({ ...userDto });

  //   await tokenService.saveToken(userDto.id, tokens.refreshToken);
  //   return { ...tokens, user: userDto };
  // }

  async getAllUsers() {
    const users = await User.find();
    return users;
  }
}

module.exports = new UserService();
