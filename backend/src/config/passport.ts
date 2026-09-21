import passport from "passport";
import { User } from "../models/User";

passport.serializeUser((user: Express.User, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id);

    if (!user) {
      done(null, false);
      return;
    }

    done(null, {
      _id: user._id,
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
    });
  } catch (err) {
    done(err);
  }
});

export default passport;
