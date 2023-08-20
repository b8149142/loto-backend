const { LotoSetting } = require("../models/db-models");

class LotoSettingsController {
  async getSettings(req, res) {
    try {
      const settings = await LotoSetting.findAll();
      res.json(settings);
    } catch (e) {
      console.log(e);
      res.status(400).json({ message: "Get settings error" });
    }
  }

  async updateSetting(req, res) {
    try {
      const { allowBots, maxBots, maxTickets, winChance } = req.body;
      const gameLevel = req.params.id;
      if (!gameLevel || (!allowBots && !maxBots && !maxTickets && !winChance)) {
        return res
          .status(400)
          .json({ message: "Incorrect request (missing fields)" });
      }

      await LotoSetting.update(
        { allowBots, maxBots, maxTickets, winChance },
        { where: { gameLevel } }
      );
    } catch (e) {
      console.log(e);
      res.status(400).json({ message: "Update error" });
    }
  }
}

module.exports = new LotoSettingsController();
