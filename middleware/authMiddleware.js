const jwt = require("jsonwebtoken");
const ProjectGroup = require("../model/projectGroup");
const Project = require("../model/project");
const Organization = require("../model/organization");
const Api = require("../model/ApiCollection");
const Workspace = require("../model/workspace");
const User = require("../model/user");
const Staff = require("../model/admin/staff");
const Role = require("../model/admin/role");
const AppError = require("../errors/AppError");
const catchAsync = require("../utils/catchAsync");
const projectGroupPermission = require("../model/projectGroupPermission");

exports.requireSignin = catchAsync(async (req, res, next) => {
  if (req.headers.authorization) {
    const token = req.headers.authorization?.split(" ")[1];
    const org = req.headers?.org;

    const project = req.headers?.project;

    const team = req.headers?.team;
    console.log(req.headers.authorization);
    const user = jwt.verify(token, process.env.JWT_SECRET);
    // console.log(user)

    let findUser = await User.findById(user._id)
      .select("_id email firstName lastName profilePicture role fullName")
      .exec();

    if (!findUser) {
      // return res.status(400).json({ error: "Invalid token" });
      throw new AppError(400, " Invalid token");
    }

    req.user = JSON.parse(JSON.stringify(findUser));
    if (project) {
      req.project = project;
      // console.log(req.project);
    }
    if (org) {
      req.organization = org;
    }
    if (team) {
      req.team = team;
    }

    // console.log(req.project);
  } else {
    // return res.status(400).json({ error: "Authorization required" });
    throw new AppError(400, " Authorization required");
  }
  next();
  //jwt.decode()
});

exports.staffMiddleware = catchAsync(async (req, res, next) => {
  if (req.user.role === "master" || req.user.role === "staff") {
    return next();
  } else {
    // return res.status(400).json({ error: "User access denied" });
    throw new AppError(400, " User access denied");
  }
});

exports.requireAdmin = (type, method) => {
  return catchAsync(async (req, res, next) => {
    if (!type || !method) {
      // return res.status(403).json({ error: "Access denied" });
      throw new AppError(403, " Access denied");
    }

    const staff = await Staff.findOne({
      user: req.user._id,
      isActive: true,
    }).exec();

    if (!staff) {
      // return res.status(403).json({ error: "Access denied" });
      throw new AppError(403, " Access denied");
    }

    if (staff?.isMaster) {
      next();
    } else {
      const query = {
        _id: { $in: staff.roles },
      };
      let getPermission = await Role.distinct(
        `permissions.${type}.${method}`,
        query
      ).exec();

      if (getPermission?.includes(true)) {
        next();
      } else {
        // return res.status(403).json({ error: "Permission denied" });
        throw new AppError(403, " Permission denied");
      }
    }
  });
};

exports.getPermission = (type, method) => {
  return catchAsync(async (req, res, next) => {
    if (!req?.project) {
      // return res.status(400).json({ error: "Project not selected" });
      throw new AppError(400, " Project not selected");
    }

    if (!req?.team) {
      // return res.status(400).json({ error: "Team not selected" });
      throw new AppError(400, " Team not selected");
    }

    let findProject = await Project.findById(req.project).exec();

    if (!findProject) {
      // return res.status(400).json({ error: "Project not found" });
      throw new AppError(400, " Project not found");
    }
    if (findProject?.isTrash) {
      // return res.status(400).json({ error: "Project is not active" });
      throw new AppError(400, " Project is not active");
    }

    let findOrg = await Organization.findById(findProject?.organization).exec();
    if (!findOrg) {
      // return res.status(400).json({ error: "Organization not found" });
      throw new AppError(400, " Organization not found");
    }
    if (findOrg?.isTrash) {
      // return res.status(400).json({ error: "Organization is not active" });
      throw new AppError(400, " Organization is not active");
    }

    if (req?.project && req?.team) {
      let team = await ProjectGroup.findOne({
        _id: req?.team,
        "members.user": { $in: req?.user?._id },
        project: req?.project,
      }).exec();
      if (!team) {
        // return res.status(400).json({ error: "Invalid team" });
        throw new AppError(400, " Invalid team");
      }
      let project = await Project.findById(req?.project)
        .select("organization createdBy")
        .exec();
      let organization = await Organization.findById(project?.organization);
      let member = organization.members.find(
        (member) => member.user.toString() === req.user._id.toString()
      );
      console.log(member);

      if (!member) {
        throw new AppError(403, "You are not a member of this organization");
      }

      // Check if the user is an administrator
      if (
        member.accessLevel === "administrator" ||
        project?.createdBy.toString() === req.user._id
      ) {
        next();
      } else {
        // let permission = await ProjectGroup.findOne({
        //   project: req?.project,
        //   "members.user": { $in: req.user._id },
        // }).exec();
        let permission = await ProjectGroup.distinct(`${type}.${method}`, {
          project: req?.project,
          "members.user": { $in: req.user._id },
        }).exec();

        if (permission?.includes(true)) {
          next();
        } else {
          // return res.status(400).json({ error: "Permission denied" });
          throw new AppError(400, " Permission denied");
        }

        // if(permission){
        //   let check = await projectGroupPermission.distinct(`${type}.${method}`, {projectGrp: permission._id})
        //   if(check.includes(true)){
        //     next()
        //     }else{
        //       throw new AppError(400, " Permission denied");
        //       }
        // }else{
        //   throw new AppError(400, " Permission denied");
        // }
      }
    } else {
      // return res.status(400).json({ error: "Permission denied" });
      throw new AppError(400, " Permission denied");
    }
  });
};

exports.apiPermission = (method) => {
  return catchAsync(async (req, res, next) => {
    let workspace = null;
    if (method === "create") {
      workspace = await Workspace.findById(req.body?.workspace)
        .select("members createdBy")
        .exec();
    }
    if (method === "update" || method === "delete") {
      let api = await Api.findById(req.params?.api)
        .select("workspace")
        .populate("workspace", "members createdBy")
        .exec();
      workspace = api?.workspace;
    }

    if (workspace?.createdBy.toString() === req.user._id) {
      next();
    } else {
      let myTeamsIds = await ProjectGroup.distinct("_id", {
        members: req.member,
      }).exec();
      let myPermission =
        workspace?.members?.find(
          (x) =>
            x.user?.toString() === req.user._id ||
            myTeamsIds?.map((x) => x.toString())?.includes(x.team?.toString())
        )?.roles || {};

      if (myPermission?.[method] === true) {
        next();
      } else {
        // return res.status(400).json({ error: "Permission denied" });
        throw new AppError(400, " Permission denied");
      }
    }
  });
};

exports.attchUser = catchAsync(async (req, res, next) => {
  if (req.headers.authorization) {
    const token = req.headers.authorization?.split(" ")[1];
    const org = req.headers?.org;

    const project = req.headers?.project;

    const team = req.headers?.team;
    const user = jwt.verify(token, process.env.JWT_SECRET);

    let findUser = await User.findById(user._id)
      .select("_id email firstName lastName profilePicture")
      .lean()
      .exec();

    if (!findUser) {
      return next();
    }

    req.user = JSON.parse(JSON.stringify(findUser));
    if (project) {
      req.project = project;
      // console.log(req.project);
    }
    if (org) {
      req.organization = org;
    }
    if (team) {
      req.team = team;
    }

    next();
  } else {
    next();
  }
});
