const sequelize = require("../db");
const { DataTypes } = require("sequelize");

const User = sequelize.define("user", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, unique: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  username: { type: DataTypes.STRING, allowNull: false },
  isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
  balance: { type: DataTypes.FLOAT, defaultValue: 0 },
  wins: { type: DataTypes.INTEGER, defaultValue: 0 },
  losses: { type: DataTypes.INTEGER, defaultValue: 0 },
});

const Stats = sequelize.define("stat", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  moneyLotoWon: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyDominoWon: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyNardsWon: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyLotoLost: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyDominoLost: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyNardsLost: { type: DataTypes.FLOAT, defaultValue: 0 },
  lotoTokens: { type: DataTypes.FLOAT, defaultValue: 0 },
  dominoTokens: { type: DataTypes.FLOAT, defaultValue: 0 },
  nardsTokens: { type: DataTypes.FLOAT, defaultValue: 0 },
  gameLotoPlayed: { type: DataTypes.INTEGER, defaultValue: 0 },
  gameDominoPlayed: { type: DataTypes.INTEGER, defaultValue: 0 },
  gameNardsPlayed: { type: DataTypes.INTEGER, defaultValue: 0 },
  deposited: { type: DataTypes.FLOAT, defaultValue: 0 },
  withdrawn: { type: DataTypes.FLOAT, defaultValue: 0 },
});

const BotStats = sequelize.define("botstat", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  moneyLotoWon: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyDominoWon: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyNardsWon: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyLotoLost: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyDominoLost: { type: DataTypes.FLOAT, defaultValue: 0 },
  moneyNardsLost: { type: DataTypes.FLOAT, defaultValue: 0 },
  lotoRoomWins: {
    type: DataTypes.JSON,
    defaultValue: JSON.stringify({
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    }),
  },
  dominoRoomWins: {
    type: DataTypes.JSON,
    defaultValue: JSON.stringify({
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    }),
  },
  nardsRoomWins: {
    type: DataTypes.JSON,
    defaultValue: JSON.stringify({
      room1: 0,
      room2: 0,
      room3: 0,
      room4: 0,
      room5: 0,
    }),
  },
});

const Token = sequelize.define("token", {
  userId: { type: DataTypes.INTEGER },
  refreshToken: { type: DataTypes.STRING },
});

const LotoCard = sequelize.define("card", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    unique: true,
    allowNull: false,
  },
  gameLevel: { type: DataTypes.INTEGER, allowNull: false },
  card: { type: DataTypes.JSON, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
});

const LotoGame = sequelize.define("lotoGame", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  startedAt: { type: DataTypes.DATE },
  finishesAt: { type: DataTypes.DATE },
  isStarted: { type: DataTypes.BOOLEAN, defaultValue: false },
  isWaiting: { type: DataTypes.BOOLEAN, defaultValue: false },
  gameLevel: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  bots: { type: DataTypes.INTEGER, defaultValue: 0 },
  botsTickets: { type: DataTypes.JSON, defaultValue: "[]" },
  prevBank: { type: DataTypes.FLOAT, defaultValue: 0 },
  jackpot: { type: DataTypes.FLOAT, defaultValue: 0 },
});

const UserGame = sequelize.define("usergame", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  tickets: { type: DataTypes.JSON, defaultValue: "[]" },
  casks: { type: DataTypes.JSON, defaultValue: "[]" },
  isWinner: { type: DataTypes.BOOLEAN, defaultValue: false },
  winIndex: { type: DataTypes.INTEGER, defaultValue: 0 },
  winSum: { type: DataTypes.FLOAT, defaultValue: 0 },
  bet: { type: DataTypes.FLOAT, defaultValue: 0 },
  bank: { type: DataTypes.FLOAT, defaultValue: 0 },
  isJackpotWon: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const LotoSetting = sequelize.define("lotosetting", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  gameLevel: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  allowBots: { type: DataTypes.BOOLEAN, defaultValue: false },
  maxBots: { type: DataTypes.INTEGER, defaultValue: 0 },
  maxTickets: { type: DataTypes.INTEGER, defaultValue: 0 },
  winChance: { type: DataTypes.FLOAT, defaultValue: 0 },
  maxCasksJackpot: { type: DataTypes.INTEGER, defaultValue: 60 },
  canBotWinJackpot: { type: DataTypes.BOOLEAN, defaultValue: true },
});

const Bot = sequelize.define("bot", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    unique: true,
    allowNull: false,
    autoIncrement: true,
  },
  username: { type: DataTypes.STRING, allowNull: false },
  moneyLotoWon: { type: DataTypes.FLOAT, defaultValue: 0 },
  lotoTokens: { type: DataTypes.FLOAT, defaultValue: 0 },
});

User.hasOne(Stats);
Stats.belongsTo(User);

User.hasMany(UserGame);
UserGame.belongsTo(User);

User.hasMany(Token);
Token.belongsTo(User);

User.hasMany(LotoCard);
LotoCard.belongsTo(User);

module.exports = {
  User,
  Token,
  LotoSetting,
  LotoGame,
  LotoCard,
  Stats,
  BotStats,
  UserGame,
  Bot,
};
