const { differenceInSeconds } = require("date-fns");
const promisify = require("util").promisify;
const bcrypt = require("bcryptjs");
const { isbot } = require("isbot");
const URL = require("url");
const dns = require("dns");

const validators = require("./validators.handler");
const map = require("../utils/map.json");
const transporter = require("../mail");
const query = require("../queries");
const queue = require("../queues");
const utils = require("../utils");
const env = require("../env");

const CustomError = utils.CustomError;
const dnsLookup = promisify(dns.lookup);

async function get(req, res) {
  console.debug("Get links...");
  const { limit, skip } = req.context;
  const search = req.query.search;
  const userId = req.user.id;

  const match = {
    user_id: userId,
  };

  const [data, total] = await Promise.all([
    query.link.get(match, { limit, search, skip }),
    query.link.total(match, { search }),
  ]);

  const links = data.map(utils.sanitize.link);

  if (req.isHTML) {
    res.render("partials/links/table", {
      total,
      limit,
      skip,
      links,
    });
    return;
  }

  console.debug("Links: ", links);

  return res.send({
    total,
    limit,
    skip,
    data: links,
  });
}

async function getAdmin(req, res) {
  const { limit, skip } = req.context;
  const search = req.query.search;
  const user = req.query.user;
  let domain = req.query.domain;
  const banned = utils.parseBooleanQuery(req.query.banned);
  const anonymous = utils.parseBooleanQuery(req.query.anonymous);
  const has_domain = utils.parseBooleanQuery(req.query.has_domain);

  const match = {
    ...(banned !== undefined && { banned }),
    ...(anonymous !== undefined && {
      user_id: [anonymous ? "is" : "is not", null],
    }),
    ...(has_domain !== undefined && {
      domain_id: [has_domain ? "is not" : "is", null],
    }),
  };

  // if domain is equal to the defualt domain,
  // it means admins is looking for links with the defualt domain (no custom user domain)
  if (domain === env.DEFAULT_DOMAIN) {
    domain = undefined;
    match.domain_id = null;
  }

  const [data, total] = await Promise.all([
    query.link.getAdmin(match, { limit, search, user, domain, skip }),
    query.link.totalAdmin(match, { search, user, domain }),
  ]);

  const links = data.map(utils.sanitize.link_admin);

  if (req.isHTML) {
    res.render("partials/admin/links/table", {
      total,
      total_formatted: total.toLocaleString("en-US"),
      limit,
      skip,
      links,
    });
    return;
  }

  return res.send({
    total,
    limit,
    skip,
    data: links,
  });
}

async function create(req, res) {
  console.debug("Create link: ", req.body);
  const {
    reuse,
    password,
    customurl,
    description,
    target,
    fetched_domain,
    expire_in,
  } = req.body;
  const domain_id = fetched_domain ? fetched_domain.id : null;

  const targetDomain = utils.removeWww(URL.parse(target).hostname);

  const tasks = await Promise.all([
    validators.cooldown(req.user),
    validators.malware(req.user, target),
    reuse &&
      query.link.find({
        target,
        user_id: req.user.id,
        domain_id,
      }),
    customurl &&
      query.link.find({
        address: customurl,
        domain_id,
      }),
    !customurl && utils.generateId(query, domain_id),
    validators.bannedDomain(targetDomain),
    validators.bannedHost(targetDomain),
  ]);

  // if "reuse" is true, try to return
  // the existent URL without creating one
  if (tasks[2]) {
    return res.json(utils.sanitize.link(tasks[2]));
  }

  // Check if custom link already exists
  if (tasks[3]) {
    const error = "Custom URL is already in use.";
    res.locals.errors = { customurl: error };
    throw new CustomError(error);
  }

  // Create new link
  const address = customurl || tasks[4];
  const link = await query.link.create({
    password,
    address,
    domain_id,
    description,
    target,
    expire_in,
    user_id: req.user && req.user.id,
  });

  link.domain = fetched_domain?.address;

  if (req.isHTML) {
    res.setHeader("HX-Trigger", "reloadMainTable");
    const shortURL = utils.getShortURL(link.address, link.domain);
    return res.render("partials/shortener", {
      link: shortURL.link,
      url: shortURL.url,
    });
  }

  console.debug("Created link: ", link);

  return res.status(201).send(utils.sanitize.link({ ...link }));
}

async function edit(req, res) {
  const link = await query.link.find({
    uuid: req.params.id,
    ...(!req.user.admin && { user_id: req.user.id }),
  });

  if (!link) {
    throw new CustomError("Link was not found.");
  }

  let isChanged = false;
  [
    [req.body.address, "address"],
    [req.body.target, "target"],
    [req.body.description, "description"],
    [req.body.expire_in, "expire_in"],
    [req.body.password, "password"],
  ].forEach(([value, name]) => {
    if (!value) {
      if (name === "password" && link.password) req.body.password = null;
      else {
        delete req.body[name];
        return;
      }
    }
    if (value === link[name] && name !== "password") {
      delete req.body[name];
      return;
    }
    if (name === "expire_in" && link.expire_in)
      if (
        Math.abs(
          differenceInSeconds(
            utils.parseDatetime(value),
            utils.parseDatetime(link.expire_in)
          )
        ) < 60
      )
        return;
    if (name === "password")
      if (value && value.replace(/•/gi, "").length === 0) {
        delete req.body.password;
        return;
      }
    isChanged = true;
  });

  if (!isChanged) {
    throw new CustomError("Should at least update one field.");
  }

  const { address, target, description, expire_in, password } = req.body;

  const targetDomain = target && utils.removeWww(URL.parse(target).hostname);
  const domain_id = link.domain_id || null;

  const tasks = await Promise.all([
    validators.cooldown(req.user),
    target && validators.malware(req.user, target),
    address &&
      query.link.find({
        address,
        domain_id,
      }),
    target && validators.bannedDomain(targetDomain),
    target && validators.bannedHost(targetDomain),
  ]);

  // Check if custom link already exists
  if (tasks[2]) {
    const error = "Custom URL is already in use.";
    res.locals.errors = { address: error };
    throw new CustomError("Custom URL is already in use.");
  }

  // Update link
  const [updatedLink] = await query.link.update(
    {
      id: link.id,
    },
    {
      ...(address && { address }),
      ...(description && { description }),
      ...(target && { target }),
      ...(expire_in && { expire_in }),
      ...((password || password === null) && { password }),
    }
  );

  if (req.isHTML) {
    res.render("partials/links/edit", {
      swap_oob: true,
      success: "Link has been updated.",
      ...utils.sanitize.link({ ...link, ...updatedLink }),
    });
    return;
  }

  return res.status(200).send(utils.sanitize.link({ ...link, ...updatedLink }));
}

async function editAdmin(req, res) {
  const link = await query.link.find({
    uuid: req.params.id,
    ...(!req.user.admin && { user_id: req.user.id }),
  });

  if (!link) {
    throw new CustomError("Link was not found.");
  }

  let isChanged = false;
  [
    [req.body.address, "address"],
    [req.body.target, "target"],
    [req.body.description, "description"],
    [req.body.expire_in, "expire_in"],
    [req.body.password, "password"],
  ].forEach(([value, name]) => {
    if (!value) {
      if (name === "password" && link.password) req.body.password = null;
      else {
        delete req.body[name];
        return;
      }
    }
    if (value === link[name] && name !== "password") {
      delete req.body[name];
      return;
    }
    if (name === "expire_in" && link.expire_in)
      if (
        Math.abs(
          differenceInSeconds(
            utils.parseDatetime(value),
            utils.parseDatetime(link.expire_in)
          )
        ) < 60
      )
        return;
    if (name === "password")
      if (value && value.replace(/•/gi, "").length === 0) {
        delete req.body.password;
        return;
      }
    isChanged = true;
  });

  if (!isChanged) {
    throw new CustomError("Should at least update one field.");
  }

  const { address, target, description, expire_in, password } = req.body;

  const targetDomain = target && utils.removeWww(URL.parse(target).hostname);
  const domain_id = link.domain_id || null;

  const tasks = await Promise.all([
    validators.cooldown(req.user),
    target && validators.malware(req.user, target),
    address &&
      query.link.find({
        address,
        domain_id,
      }),
    target && validators.bannedDomain(targetDomain),
    target && validators.bannedHost(targetDomain),
  ]);

  // Check if custom link already exists
  if (tasks[2]) {
    const error = "Custom URL is already in use.";
    res.locals.errors = { address: error };
    throw new CustomError("Custom URL is already in use.");
  }

  // Update link
  const [updatedLink] = await query.link.update(
    {
      id: link.id,
    },
    {
      ...(address && { address }),
      ...(description && { description }),
      ...(target && { target }),
      ...(expire_in && { expire_in }),
      ...((password || password === null) && { password }),
    }
  );

  if (req.isHTML) {
    res.render("partials/admin/links/edit", {
      swap_oob: true,
      success: "Link has been updated.",
      ...utils.sanitize.linkAdmin({ ...link, ...updatedLink }),
    });
    return;
  }

  return res.status(200).send(utils.sanitize.link({ ...link, ...updatedLink }));
}

async function remove(req, res) {
  const { error, isRemoved, link } = await query.link.remove({
    uuid: req.params.id,
    ...(!req.user.admin && { user_id: req.user.id }),
  });

  if (!isRemoved) {
    const messsage = error || "Could not delete the link.";
    throw new CustomError(messsage);
  }

  if (req.isHTML) {
    res.setHeader("HX-Reswap", "outerHTML");
    res.setHeader("HX-Trigger", "reloadMainTable");
    res.render("partials/links/dialog/delete_success", {
      link: utils.getShortURL(link.address, link.domain).link,
    });
    return;
  }

  return res
    .status(200)
    .send({ message: "Link has been deleted successfully." });
}

async function report(req, res) {
  const { link } = req.body;

  await transporter.sendReportEmail(link);

  if (req.isHTML) {
    res.render("partials/report/form", {
      message: "Report was received. We'll take actions shortly.",
    });
    return;
  }

  return res
    .status(200)
    .send({ message: "Thanks for the report, we'll take actions shortly." });
}

async function ban(req, res) {
  const { id } = req.params;

  const update = {
    banned_by_id: req.user.id,
    banned: true,
  };

  // 1. check if link exists
  const link = await query.link.find({ uuid: id });

  if (!link) {
    throw new CustomError("No link has been found.", 400);
  }

  if (link.banned) {
    throw new CustomError("Link has been banned already.", 400);
  }

  const tasks = [];

  // 2. ban link
  tasks.push(query.link.update({ uuid: id }, update));

  const domain = utils.removeWww(URL.parse(link.target).hostname);

  // 3. ban target's domain
  if (req.body.domain) {
    tasks.push(query.domain.add({ ...update, address: domain }));
  }

  // 4. ban target's host
  if (req.body.host) {
    const dnsRes = await dnsLookup(domain).catch(() => {
      throw new CustomError("Couldn't fetch DNS info.");
    });
    const host = dnsRes?.address;
    tasks.push(query.host.add({ ...update, address: host }));
  }

  // 5. ban link owner
  if (req.body.user && link.user_id) {
    tasks.push(query.user.update({ id: link.user_id }, update));
  }

  // 6. ban all of owner's links
  if (req.body.userLinks && link.user_id) {
    tasks.push(query.link.update({ user_id: link.user_id }, update));
  }

  // 7. wait for all tasks to finish
  await Promise.all(tasks).catch((err) => {
    throw new CustomError("Couldn't ban entries.");
  });

  // 8. send response
  if (req.isHTML) {
    res.setHeader("HX-Reswap", "outerHTML");
    res.setHeader("HX-Trigger", "reloadMainTable");
    res.render("partials/links/dialog/ban_success", {
      link: utils.getShortURL(link.address, link.domain).link,
    });
    return;
  }

  return res.status(200).send({ message: "Banned link successfully." });
}

async function redirect(req, res, next) {
  const isPreservedUrl = utils.preservedURLs.some(
    (item) => item === req.path.replace("/", "")
  );

  if (isPreservedUrl) return next();

  // 1. If custom domain, get domain info
  const host = utils.removeWww(req.headers.host);
  const domain =
    host !== env.DEFAULT_DOMAIN
      ? await query.domain.find({ address: host })
      : null;

  // 2. Get link
  const address = req.params.id.replace("+", "");
  const link = await query.link.find({
    address,
    domain_id: domain ? domain.id : null,
  });

  // 3. When no link, if has domain redirect to domain's homepage
  // otherwise redirect to 404
  if (!link) {
    return res.redirect(domain?.homepage || "/404");
  }

  // 4. If link is banned, redirect to banned page.
  if (link.banned) {
    return res.redirect("/banned");
  }

  // 5. If wants to see link info, then redirect
  const isRequestingInfo = /.*\+$/gi.test(req.params.id);
  if (isRequestingInfo && !link.password) {
    if (req.isHTML) {
      res.render("url_info", {
        title: "Short link information",
        target: link.target,
        link: utils.getShortURL(link.address, link.domain).link,
      });
      return;
    }
    return res.send({ target: link.target });
  }

  // 6. If link is protected, redirect to password page
  if (link.password) {
    res.render("protected", {
      title: "Protected short link",
      id: link.uuid,
    });
    return;
  }

  // 7. Create link visit
  const isBot = isbot(req.headers["user-agent"]);
  if (link.user_id && !isBot) {
    queue.visit.add({
      userAgent: req.headers["user-agent"],
      ip: req.ip,
      referrer: req.get("Referrer"),
      link,
    });
  }

  // 8. Redirect to target
  return res.redirect(link.target);
}

async function redirectProtected(req, res) {
  // 1. Get link
  const uuid = req.params.id;
  const link = await query.link.find({ uuid });

  // 2. Throw error if no link
  if (!link || !link.password) {
    throw new CustomError("Couldn't find the link.", 400);
  }

  // 3. Check if password matches
  const matches = await bcrypt.compare(req.body.password, link.password);

  if (!matches) {
    throw new CustomError("Password is not correct.", 401);
  }

  // 4. Create visit
  if (link.user_id) {
    queue.visit.add({
      userAgent: req.headers["user-agent"],
      ip: req.ip,
      referrer: req.get("Referrer"),
      link,
    });
  }

  // 5. Send target
  if (req.isHTML) {
    res.setHeader("HX-Redirect", link.target);
    res.render("partials/protected/form", {
      id: link.uuid,
      message: "Redirecting...",
    });
    return;
  }
  return res.status(200).send({ target: link.target });
}

async function redirectCustomDomainHomepage(req, res, next) {
  const path = req.path;
  const host = utils.removeWww(req.headers.host);

  if (host === env.DEFAULT_DOMAIN) {
    return next();
  }

  if (
    path === "/" ||
    utils.preservedURLs
      .filter((l) => l !== "url-password")
      .some((item) => item === path.replace("/", ""))
  ) {
    const domain = await query.domain.find({ address: host });
    const redirectURL = domain
      ? domain.homepage
      : `https://${env.DEFAULT_DOMAIN + path}`;

    return res.redirect(302, redirectURL);
  }

  return next();
}

async function stats(req, res) {
  const { user } = req;
  const uuid = req.params.id;

  const link = await query.link.find({
    ...(!user.admin && { user_id: user.id }),
    uuid,
  });

  if (!link) {
    if (req.isHTML) {
      res.setHeader("HX-Redirect", "/404");
      res.status(200).send("");
      return;
    }
    throw new CustomError("Link could not be found.");
  }

  const stats = await query.visit.find({ link_id: link.id }, link.visit_count);

  if (!stats) {
    throw new CustomError(
      "Could not get the short link stats. Try again later."
    );
  }

  if (req.isHTML) {
    res.render("partials/stats", {
      link: utils.sanitize.link(link),
      stats,
      map,
    });
    return;
  }

  return res.status(200).send({
    ...stats,
    ...utils.sanitize.link(link),
  });
}

module.exports = {
  ban,
  create,
  edit,
  editAdmin,
  get,
  getAdmin,
  remove,
  report,
  stats,
  redirect,
  redirectProtected,
  redirectCustomDomainHomepage,
};
