const Router = require("express").Router;
const userController = require("../controllers/user-controller");
const lotosettingsController = require("../controllers/lotosettings-controller");
const router = new Router();
const { body } = require("express-validator");
const authMiddleware = require("../middlewares/auth-middleware");

const gameRouter = require("./game-router");

// user
router.post(
  "/registration",
  //   body("username").isEmpty(),
  body("email").isEmail(),
  body("password").isLength({ min: 3, max: 32 }),
  userController.registration
);

router.get("/get-user", authMiddleware, userController.getUser);

router.put("/change-password", authMiddleware, userController.changePassword);

// login

router.post("/login", userController.login);

router.post("/logout", userController.logout);

router.get("/checkAuth", authMiddleware, userController.checkAuth);

// leaders page

router.get("/leaders/:gameType", authMiddleware, userController.getLeaders);

router.get("/get-games", authMiddleware, userController.getGames);

// admin
router.get("/botsStat/:gameType", authMiddleware, userController.getBots);
router.get("/allUsersStats", authMiddleware, userController.getAllUsersStats);
router.get("/bot-wins", authMiddleware, userController.getBotWins);

// game

router.use("/game", authMiddleware, gameRouter);

// loto settings

router.get("/loto-settings", lotosettingsController.getSettings);
router.put("/loto-settings/:id", lotosettingsController.updateSetting);

module.exports = router;
