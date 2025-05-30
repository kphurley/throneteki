import bcrypt from 'bcrypt';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import moment from 'moment';
import _ from 'underscore';
import sendgrid from '@sendgrid/mail';
import logger from '../log.js';
import { wrapAsync } from '../util.js';
import { writeFile } from 'fs/promises';
import ServiceFactory from '../services/ServiceFactory.js';
const configService = ServiceFactory.configService();
const appName = configService.getValue('appName');

let userService;

function hashPassword(password, rounds) {
    return new Promise((resolve, reject) => {
        bcrypt.hash(password, rounds, function (err, hash) {
            if (err) {
                return reject(err);
            }

            return resolve(hash);
        });
    });
}

function sendEmail(address, subject, email) {
    const message = {
        to: address,
        from: 'The Iron Throne <noreply@theironthrone.net>',
        subject: subject,
        text: email
    };

    return sendgrid.send(message).catch((err) => {
        logger.error('Unable to send email %s', err);
    });
}

function validateUserName(username) {
    if (!username) {
        return 'You must specify a username';
    }

    if (username.length < 3 || username.length > 15) {
        return 'Username must be at least 3 characters and no more than 15 characters long';
    }

    if (!username.match(/^[A-Za-z0-9_-]+$/)) {
        return 'Usernames must only use the characters a-z, 0-9, _ and -';
    }

    return undefined;
}

function validateEmail(email) {
    if (!email) {
        return 'You must specify an email address';
    }

    if (
        !email.match(
            /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
        )
    ) {
        return 'Please enter a valid email address';
    }

    return undefined;
}

function validatePassword(password) {
    if (!password) {
        return 'You must specify a password';
    }

    if (password.length < 6) {
        return 'Password must be at least 6 characters';
    }

    return undefined;
}

const DefaultEmailHash = crypto.createHash('md5').update('noreply@theironthrone.net').digest('hex');

export const init = function (server, options) {
    userService = ServiceFactory.userService(options.db, configService);
    let banlistService = ServiceFactory.banlistService(options.db);
    let patreonService = ServiceFactory.patreonService(
        configService.getValue('patreonClientId'),
        configService.getValue('patreonSecret'),
        userService,
        configService.getValue('patreonCallbackUrl')
    );
    let emailKey = configService.getValue('emailKey');

    if (emailKey) {
        sendgrid.setApiKey(emailKey);
    }

    server.post(
        '/api/account/register',
        wrapAsync(async (req, res, next) => {
            let message = validateUserName(req.body.username);
            if (message) {
                res.status(400).send({ success: false, message: message });

                return next();
            }

            message = validateEmail(req.body.email);
            if (message) {
                res.status(400).send({ success: false, message: message });
                return next();
            }

            message = validatePassword(req.body.password);
            if (message) {
                res.status(400).send({ success: false, message: message });
                return next();
            }

            let user = await userService.getUserByEmail(req.body.email);
            if (user) {
                res.status(400).send({
                    success: false,
                    message: 'An account with that email already exists, please use another'
                });

                return next();
            }

            user = await userService.getUserByUsername(req.body.username);
            if (user) {
                res.status(400).send({
                    success: false,
                    message: 'An account with that name already exists, please choose another'
                });

                return next();
            }

            let domain = req.body.email.substring(req.body.email.lastIndexOf('@') + 1);

            let emailBlockKey = configService.getValue('emailBlockKey');
            if (emailBlockKey) {
                try {
                    let response = await fetch(
                        `http://check.block-disposable-email.com/easyapi/json/${emailBlockKey}/${domain}`
                    );
                    let answer = response.json();

                    if (answer.request_status !== 'success') {
                        logger.warn('Failed to check email address %s', answer);
                    }

                    if (answer.domain_status === 'block') {
                        logger.warn(
                            'Blocking %s from registering the account %s',
                            domain,
                            req.body.username
                        );
                        res.status(400).send({
                            success: false,
                            message:
                                'One time use email services are not permitted on this site.  Please use a real email address'
                        });

                        return next();
                    }
                } catch (err) {
                    logger.warn('Could not valid email address %s %s', domain, err);
                }
            }

            let passwordHash = await hashPassword(req.body.password, 10);

            let requireActivation = configService.getValue('requireActivation');

            if (requireActivation) {
                let expiration = moment().add(7, 'days');
                let formattedExpiration = expiration.format('YYYYMMDD-HH:mm:ss');
                let hmac = crypto.createHmac('sha512', configService.getValue('hmacSecret'));

                let activationToken = hmac
                    .update(`ACTIVATE ${req.body.username} ${formattedExpiration}`)
                    .digest('hex');
                newUser.activationToken = activationToken;
                newUser.activationTokenExpiry = formattedExpiration;
            }

            let ip = req.get('x-real-ip');
            if (!ip) {
                ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            }
            try {
                let lookup = await banlistService.getEntryByIp(ip);
                if (lookup) {
                    return res.status(400).send({
                        success: false,
                        message:
                            'An error occurred registering your account, please try again later.'
                    });
                }
            } catch (err) {
                logger.error(err);

                return res.status(400).send({
                    success: false,
                    message: 'An error occurred registering your account, please try again later.'
                });
            }

            let newUser = {
                password: passwordHash,
                registered: new Date(),
                username: req.body.username,
                email: req.body.email,
                enableGravatar: req.body.enableGravatar,
                verified: !requireActivation,
                registerIp: ip
            };

            user = await userService.addUser(newUser);
            if (requireActivation) {
                let url = `${req.protocol}://${req.get('host')}/activation?id=${user._id}&token=${newUser.activationToken}`;
                let emailText =
                    `Hi,\n\nSomeone, hopefully you, has requested an account to be created on ${appName} (${req.protocol}://${req.get('host')}).  If this was you, click this link ${url} to complete the process.\n\n` +
                    'If you did not request this please disregard this email.\n' +
                    'Kind regards,\n\n' +
                    `${appName} team`;

                await sendEmail(user.email, `${appName} - Account activation`, emailText);
            }

            res.send({ success: true, data: requireActivation });

            await downloadAvatar(user);
        })
    );

    server.post(
        '/api/account/activate',
        wrapAsync(async (req, res, next) => {
            if (!req.body.id || !req.body.token) {
                return res.status(400).send({ success: false, message: 'Invalid parameters' });
            }

            if (!req.body.id.match(/^[a-f\d]{24}$/i)) {
                return res.send({ success: false, message: 'Invalid parameters' });
            }

            let user = await userService.getUserById(req.body.id);
            if (!user) {
                res.send({
                    success: false,
                    message:
                        'An error occured activating your account, check the url you have entered and try again.'
                });

                return next();
            }

            if (!user.activationToken) {
                logger.error('Got unexpected activate request for user %s', user.username);

                res.send({
                    success: false,
                    message:
                        'An error occured activating your account, check the url you have entered and try again.'
                });

                return next();
            }

            let now = moment();
            if (user.activationTokenExpiry < now) {
                res.send({
                    success: false,
                    message: 'The activation token you have provided has expired.'
                });

                logger.error('Token expired %s', user.username);

                return next();
            }

            let hmac = crypto.createHmac('sha512', configService.getValue('hmacSecret'));
            let resetToken = hmac
                .update('ACTIVATE ' + user.username + ' ' + user.activationTokenExpiry)
                .digest('hex');

            if (resetToken !== req.body.token) {
                logger.error('Invalid activation token', user.username, req.body.token);

                res.send({
                    success: false,
                    message:
                        'An error occured activating your account, check the url you have entered and try again.'
                });

                return next();
            }

            await userService.activateUser(user);

            res.send({ success: true });
        })
    );

    server.post(
        '/api/account/check-username',
        wrapAsync(async (req, res) => {
            let user = await userService.getUserByUsername(req.body.username);
            if (user) {
                return res.status(400).send({
                    success: false,
                    data: 'An account with that name already exists, please choose another'
                });
            }

            return res.send({ success: true });
        })
    );

    server.post(
        '/api/account/logout',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            if (!req.body.tokenId) {
                return res.send({ success: false, message: 'tokenId is required' });
            }

            let session = await userService.getRefreshTokenById(
                req.user.username,
                req.body.tokenId
            );
            if (!session) {
                return res.send({ success: false, message: 'Error occured logging out' });
            }

            await userService.removeRefreshToken(req.user.username, req.body.tokenId);

            res.send({ success: true });
        })
    );

    server.post(
        '/api/account/checkauth',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            let user = await userService.getUserByUsername(req.user.username);
            let userDetails = user.getWireSafeDetails();

            if (!user.patreon || !user.patreon.refresh_token) {
                return res.send({ success: true, data: userDetails });
            }

            userDetails.patreon = await patreonService.getPatreonStatusForUser(user);

            if (userDetails.patreon === 'none') {
                delete userDetails.patreon;

                let ret = await patreonService.refreshTokenForUser(user);
                if (!ret) {
                    return res.send({ success: true, data: userDetails });
                }

                userDetails.patreon = await patreonService.getPatreonStatusForUser(user);

                if (userDetails.patreon === 'none') {
                    return res.send({ success: true, data: userDetails });
                }
            }

            if (userDetails.patreon === 'pledged' && !userDetails.permissions.isSupporter) {
                await userService.setSupporterStatus(user.username, true);
                // eslint-disable-next-line require-atomic-updates
                userDetails.permissions.isSupporter = req.user.permissions.isSupporter = true;
            } else if (userDetails.patreon !== 'pledged' && userDetails.permissions.isSupporter) {
                await userService.setSupporterStatus(user.username, false);
                // eslint-disable-next-line require-atomic-updates
                userDetails.permissions.isSupporter = req.user.permissions.isSupporter = false;
            }

            res.send({ success: true, data: userDetails });
        })
    );

    server.post(
        '/api/account/login',
        wrapAsync(async (req, res, next) => {
            if (!req.body.username) {
                res.send({ success: false, message: 'Username must be specified' });

                return next();
            }

            if (!req.body.password) {
                res.send({ success: false, message: 'Password must be specified' });

                return next();
            }

            let user = await userService.getUserByUsername(req.body.username);
            if (!user) {
                return res.send({ success: false, message: 'Invalid username/password' });
            }

            if (user.disabled) {
                return res.send({ success: false, message: 'Invalid username/password' });
            }

            let isValidPassword;
            try {
                isValidPassword = await bcrypt.compare(req.body.password, user.password);
            } catch (err) {
                logger.error(err);

                return res.send({
                    success: false,
                    message:
                        'There was an error validating your login details.  Please try again later'
                });
            }

            if (!isValidPassword) {
                return res.send({ success: false, message: 'Invalid username/password' });
            }

            if (!user.verified) {
                return res.send({
                    success: false,
                    message: 'You must verifiy your account before trying to log in'
                });
            }

            let userObj = user.getWireSafeDetails();

            let authToken = jwt.sign(userObj, configService.getValue('secret'), {
                expiresIn: '5m'
            });
            let ip = req.get('x-real-ip');
            if (!ip) {
                ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            }

            let refreshToken = await userService.addRefreshToken(user.username, authToken, ip);
            if (!refreshToken) {
                return res.send({
                    success: false,
                    message:
                        'There was an error validating your login details.  Please try again later'
                });
            }

            res.send({
                success: true,
                data: {
                    user: userObj,
                    token: authToken,
                    refreshToken: refreshToken
                }
            });
        })
    );

    server.post(
        '/api/account/token',
        wrapAsync(async (req, res, next) => {
            if (!req.body.token) {
                res.send({ success: false, message: 'Refresh token must be specified' });

                return next();
            }

            let token = req.body.token;

            let user = await userService.getUserByUsername(token.username);
            if (!user) {
                res.send({ success: false, message: 'Invalid refresh token' });

                return next();
            }

            if (user.username !== token.username) {
                logger.error(
                    `Username ${user.username} did not match token username ${token.username}`
                );
                res.send({ success: false, message: 'Invalid refresh token' });

                return next();
            }

            let refreshToken = user.tokens.find((t) => {
                return t._id.toString() === token.id;
            });
            if (!refreshToken) {
                res.send({ success: false, message: 'Invalid refresh token' });

                return next();
            }

            if (!userService.verifyRefreshToken(user.username, refreshToken)) {
                res.send({ success: false, message: 'Invalid refresh token' });

                return next();
            }

            if (user.disabled) {
                res.send({ success: false, message: 'Invalid refresh token' });

                return next();
            }

            let userObj = user.getWireSafeDetails();

            let ip = req.get('x-real-ip');
            if (!ip) {
                ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            }

            let authToken = jwt.sign(userObj, configService.getValue('secret'), {
                expiresIn: '5m'
            });

            await userService.updateRefreshTokenUsage(refreshToken.id, ip);

            res.send({ success: true, data: { user: userObj, token: authToken } });
        })
    );

    server.post(
        '/api/account/password-reset-finish',
        wrapAsync(async (req, res, next) => {
            let resetUser;

            if (!req.body.id || !req.body.token || !req.body.newPassword) {
                return res.send({ success: false, message: 'Invalid parameters' });
            }

            let user = await userService.getUserById(req.body.id);
            if (!user) {
                res.send({
                    success: false,
                    message:
                        'An error occured resetting your password, check the url you have entered and try again.'
                });

                return next();
            }

            if (!user.resetToken) {
                logger.error('Got unexpected reset request for user %s', user.username);

                res.send({
                    success: false,
                    message:
                        'An error occured resetting your password, check the url you have entered and try again.'
                });

                return next();
            }

            let now = moment();
            if (user.tokenExpires < now) {
                res.send({
                    success: false,
                    message: 'The reset token you have provided has expired.'
                });

                logger.error('Token expired %s', user.username);

                return next();
            }

            let hmac = crypto.createHmac('sha512', configService.getValue('hmacSecret'));
            let resetToken = hmac
                .update('RESET ' + user.username + ' ' + user.tokenExpires)
                .digest('hex');

            if (resetToken !== req.body.token) {
                logger.error('Invalid reset token %s %s', user.username, req.body.token);

                res.send({
                    success: false,
                    message:
                        'An error occured resetting your password, check the url you have entered and try again.'
                });

                return next();
            }

            resetUser = user;

            let passwordHash = await hashPassword(req.body.newPassword, 10);
            await userService.setPassword(resetUser, passwordHash);
            await userService.clearResetToken(resetUser);

            res.send({ success: true });
        })
    );

    server.post(
        '/api/account/password-reset',
        wrapAsync(async (req, res) => {
            let resetToken;

            let response = await fetch(
                `https://www.google.com/recaptcha/api/siteverify?secret=${configService.getValue('captchaKey')}&response=${req.body.captcha}`
            );
            let answer = response.json();

            if (!answer.success) {
                return res.send({
                    success: false,
                    message: 'Please complete the captcha correctly'
                });
            }

            res.send({ success: true });

            let user = await userService.getUserByUsername(req.body.username);
            if (!user) {
                logger.error('Username not found for password reset %s', req.body.username);

                return;
            }

            let expiration = moment().add(4, 'hours');
            let formattedExpiration = expiration.format('YYYYMMDD-HH:mm:ss');
            let hmac = crypto.createHmac('sha512', configService.getValue('hmacSecret'));

            resetToken = hmac.update(`RESET ${user.username} ${formattedExpiration}`).digest('hex');

            await userService.setResetToken(user, resetToken, formattedExpiration);
            let url = `${req.protocol}://${req.get('host')}/reset-password?id=${user._id}&token=${resetToken}`;
            let emailText =
                `Hi,\n\nSomeone, hopefully you, has requested their password on ${appName} (${req.protocol}://${req.get('host')}) to be reset.  If this was you, click this link ${url} to complete the process.\n\n` +
                'If you did not request this reset, do not worry, your account has not been affected and your password has not been changed, just ignore this email.\n' +
                'Kind regards,\n\n' +
                `${appName} team`;

            await sendEmail(user.email, `${appName} - Password reset`, emailText);
        })
    );

    server.put(
        '/api/account/:username',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            let userToSet = req.body;

            if (req.user.username !== req.params.username) {
                return res.status(403).send({ message: 'Unauthorized' });
            }

            let user = await userService.getUserByUsername(req.params.username);
            if (!user) {
                return res.status(404).send({ message: 'Not found' });
            }

            user = user.getDetails();

            user.email = userToSet.email;
            user.settings = userToSet.settings;
            user.promptedActionWindows = userToSet.promptedActionWindows;

            if (userToSet.password && userToSet.password !== '') {
                user.password = await hashPassword(userToSet.password, 10);
            }

            user.enableGravatar = userToSet.enableGravatar;

            //await downloadAvatar(user);

            await userService.update(user);

            let updatedUser = await userService.getUserById(user._id);
            let safeUser = updatedUser.getWireSafeDetails();
            let authToken;

            if (!safeUser.disabled && !safeUser.verified) {
                authToken = jwt.sign(safeUser, configService.getValue('secret'), {
                    expiresIn: '5m'
                });
            }

            res.send(
                Object.assign(
                    { success: true },
                    { data: { user: updatedUser.getWireSafeDetails(), token: authToken } }
                )
            );
        })
    );

    server.get(
        '/api/account/:username/sessions',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            let user = await checkAuth(req, res);

            if (!user) {
                return;
            }

            let tokens = user.tokens || [];

            res.send({
                success: true,
                data: tokens
                    .sort((a, b) => {
                        return a.lastUsed < b.lastUsed;
                    })
                    .map((t) => {
                        return {
                            id: t._id,
                            ip: t.ip,
                            lastUsed: t.lastUsed
                        };
                    })
            });
        })
    );

    server.delete(
        '/api/account/:username/sessions/:id',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            if (!req.params.username) {
                return res.send({ success: false, message: 'Username is required' });
            }

            if (!req.params.id) {
                return res.send({ success: false, message: 'Session Id is required' });
            }

            let user = await checkAuth(req, res);

            if (!user) {
                return;
            }

            let session = await userService.getRefreshTokenById(req.params.username, req.params.id);
            if (!session) {
                return res.status(404).send({ message: 'Not found' });
            }

            await userService.removeRefreshToken(req.params.username, req.params.id);

            res.send({
                success: true,
                data: { message: 'Session deleted successfully', tokenId: req.params.id }
            });
        })
    );

    server.get(
        '/api/account/:username/blocklist',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            let user = await checkAuth(req, res);

            if (!user) {
                return;
            }

            let blockList = user.blockList || [];
            res.send({ success: true, data: blockList.sort() });
        })
    );

    server.post(
        '/api/account/:username/blocklist',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            let user = await checkAuth(req, res);

            if (!user) {
                return;
            }

            if (!user.blockList) {
                user.blockList = [];
            }

            let lowerCaseUser = req.body.username.toLowerCase();

            if (
                user.blockList.find((user) => {
                    return user === lowerCaseUser;
                })
            ) {
                return res.send({ success: false, message: 'Entry already on block list' });
            }

            user.blockList.push(lowerCaseUser);

            await userService.updateBlockList(user);
            let updatedUser = await userService.getUserById(user._id);

            res.send({
                success: true,
                data: {
                    message: 'Block list entry added successfully',
                    username: lowerCaseUser,
                    user: updatedUser.getWireSafeDetails()
                }
            });
        })
    );

    server.delete(
        '/api/account/:username/blocklist/:entry',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            let user = await checkAuth(req, res);

            if (!user) {
                return;
            }

            user = user.getDetails();

            if (!req.params.entry) {
                return res.send({ success: false, message: 'Parameter "entry" is required' });
            }

            if (!user.blockList) {
                user.blockList = [];
            }

            let lowerCaseUser = req.params.entry.toLowerCase();

            if (
                !user.blockList.find((user) => {
                    return user === lowerCaseUser;
                })
            ) {
                return res.status(404).send({ message: 'Not found' });
            }

            user.blockList = _.reject(user.blockList, (user) => {
                return user === lowerCaseUser;
            });

            await userService.updateBlockList(user);
            let updatedUser = await userService.getUserById(user._id);

            res.send({
                success: true,
                data: {
                    message: 'Block list entry removed successfully',
                    username: lowerCaseUser,
                    user: updatedUser.getWireSafeDetails()
                }
            });
        })
    );

    server.post(
        '/api/account/:username/updateavatar',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            let user = await checkAuth(req, res);

            if (!user) {
                return;
            }

            user = user.getDetails();

            await downloadAvatar(user);

            res.send({ success: true });
        })
    );

    server.post(
        '/api/account/linkPatreon',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            req.params.username = req.user ? req.user.username : undefined;

            let user = await checkAuth(req, res);

            if (!user) {
                return;
            }

            if (!req.body.code) {
                return res.send({ success: false, message: 'Code is required' });
            }

            user = await patreonService.linkAccount(req.params.username, req.body.code);
            if (!user) {
                return res.send({
                    success: false,
                    message:
                        'An error occured syncing your patreon account.  Please try again later.'
                });
            }

            let status = await patreonService.getPatreonStatusForUser(user);

            if (status === 'pledged' && !user.permissions.isSupporter) {
                await userService.setSupporterStatus(user.username, true);
                // eslint-disable-next-line require-atomic-updates
                user.permissions.isSupporter = req.user.permissions.isSupporter = true;
            } else if (status !== 'pledged' && user.permissions.isSupporter) {
                await userService.setSupporterStatus(user.username, false);
                // eslint-disable-next-line require-atomic-updates
                user.permissions.isSupporter = req.user.permissions.isSupporter = false;
            }

            return res.send({ success: true });
        })
    );

    server.post(
        '/api/account/unlinkPatreon',
        passport.authenticate('jwt', { session: false }),
        wrapAsync(async (req, res) => {
            req.params.username = req.user ? req.user.username : undefined;

            let user = await checkAuth(req, res);

            if (!user) {
                return;
            }

            let ret = await patreonService.unlinkAccount(req.params.username);
            if (!ret) {
                return res.send({
                    success: false,
                    message:
                        'An error occured unlinking your patreon account.  Please try again later.'
                });
            }

            return res.send({ success: true });
        })
    );
};

async function downloadAvatar(user) {
    const emailHash = user.enableGravatar
        ? crypto.createHash('md5').update(user.email).digest('hex')
        : DefaultEmailHash;
    const avatar = await fetch(`https://www.gravatar.com/avatar/${emailHash}?d=identicon&s=24`);
    const arrayBuffer = await avatar.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(`public/img/avatar/${user.username}.png`, buffer);
}

async function checkAuth(req, res) {
    let user = await userService.getUserByUsername(req.params.username);

    if (!req.user) {
        res.status(401).send({ message: 'Unauthorized' });

        return null;
    }

    if (req.user.username !== req.params.username) {
        res.status(403).send({ message: 'Forbidden' });

        return null;
    }

    if (!user) {
        res.status(401).send({ message: 'Unauthorized' });

        return null;
    }

    return user;
}
