const Router = require("express").Router;
const router = new Router();
const gameController = require("../controllers/game-controller");
const authMiddleware = require("../middlewares/auth-middleware");

router.post("/connect-loto-room/:roomId", gameController.connectLotoRoom);
router.delete(
  "/disconnect-loto-room/:roomId",
  gameController.disconnectLotoRoom
);
router.delete("/clear-all", gameController.clearAll);
router.get("/is-game-started/:roomId", gameController.isGameStarted);
router.get("/is-user-in-game/:roomId", gameController.isUserInGame);
router.get("/get-loto-online", gameController.getOnline);

router.put("/finish-loto-waiting/:roomId", gameController.finishLotoWaiting);
router.post("/create-card", gameController.createCards);
router.get("/get-card", gameController.getCards);
router.delete("/delete-card/:cardId", gameController.deleteCard);
router.delete("/delete-cards/", gameController.deleteCards);
router.delete(
  "/delete-cards-balance/",
  gameController.deleteCardsReturnBalance
);
router.get("/get-messages", gameController.getMessages);

router.post("/test", gameController.test);
router.post("/start", authMiddleware, gameController.start);

router.get("/domino-status", authMiddleware, gameController.getDominoStatus);
router.post(
  "/domino-isstarted",
  authMiddleware,
  gameController.isDominoStarted
);

module.exports = router;
