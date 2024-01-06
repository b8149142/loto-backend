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

router.post("/deposit", authMiddleware, userController.deposit);
router.get("/getCurrencyRate", authMiddleware, userController.getCurrencyRate);
router.post("/createPayout", authMiddleware, userController.createPayout);
router.get("/getPayouts", authMiddleware, userController.getPayouts);
router.put("/checkPayouts", authMiddleware, userController.checkPayouts);
router.put("/updateUserData", authMiddleware, userController.changeUserData);

// login

router.post("/login", userController.login);

router.post("/logout", userController.logout);

router.get("/checkAuth", authMiddleware, userController.checkAuth);

// edit user
router.put("/change-password", authMiddleware, userController.changePassword);
router.post("/uploadAvatar", authMiddleware, userController.uploadAvatar);
router.delete("/uploadAvatar", authMiddleware, userController.deleteAvatar);

// leaders page

router.get("/leaders/:gameType", authMiddleware, userController.getLeaders);

router.get("/get-games", authMiddleware, userController.getGames);
router.put("/exchange-tokens", authMiddleware, userController.exchangeTokens);

// admin
router.get("/botsStat/:gameType", authMiddleware, userController.getBots);
router.get("/allUsersStats", authMiddleware, userController.getAllUsersStats);
router.get("/userStats", authMiddleware, userController.getUserStats);
router.get("/bot-wins", authMiddleware, userController.getBotWins);
router.get("/played-games", userController.getPlayedGames);
router.get("/played-domino-games", userController.getPlayedDominoGames);
router.get("/rooms-control", userController.getRoomsControl);
router.put("/rooms-control/:mode", userController.updateRoomsControl);

// game

router.use("/game", authMiddleware, gameRouter);

router.get("/is-page-available/:page", userController.isPageAvailable);

// loto settings

router.get("/loto-settings", lotosettingsController.getSettings);
router.put("/loto-settings/:id", lotosettingsController.updateSetting);

module.exports = router;
