module.exports = class UserDto {
  email;
  id;
  isActivated;

  constructor(model) {
    this.email = model.email;
    this.id = model.id;
    this.name = model.name;
    this.username = model.username;
    this.balance = model.balance;
    this.isAdmin = model.isAdmin;
  }
};
