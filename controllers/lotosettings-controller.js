const { LotoSetting, LotoGame } = require("../models/db-models");

class LotoSettingsController {
  async getSettings(req, res) {
    try {
      const settings = await LotoSetting.findAll();
      const games = await LotoGame.findAll();
      const jackpots = games.map((game) => game.jackpot);
      // insert jackpots into settings
      settings.forEach((setting, index) => {
        setting.dataValues.jackpot = jackpots[index];
      });
      res.json(settings);
    } catch (e) {
      console.log(e);
      res.status(400).json({ message: "Get settings error" });
    }
  }

  async updateSetting(req, res) {
    try {
      const {
        allowBots,
        maxBots,
        maxTickets,
        winChance,
        jackpot,
        maxCasksJackpot,
        canBotWinJackpot,
        jackpotWinChance,
        minJackpotSum,
      } = req.body;
      const gameLevel = req.params.id;
      if (
        !gameLevel ||
        (!allowBots &&
          !maxBots &&
          !maxTickets &&
          !winChance &&
          !jackpot &&
          !maxCasksJackpot &&
          !canBotWinJackpot &&
          !jackpotWinChance &&
          !minJackpotSum)
      ) {
        return res
          .status(400)
          .json({ message: "Incorrect request (missing fields)" });
      }

      await LotoSetting.update(
        {
          allowBots,
          maxBots,
          maxTickets,
          winChance,
          maxCasksJackpot,
          canBotWinJackpot,
          jackpotWinChance,
          minJackpotSum,
        },
        { where: { gameLevel } }
      );
      await LotoGame.update({ jackpot }, { where: { gameLevel } });
    } catch (e) {
      console.log(e);
      res.status(400).json({ message: "Update error" });
    }
  }
}

module.exports = new LotoSettingsController();
