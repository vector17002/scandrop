import express from 'express'
import jwtMiddleware from '../middleware/jwtMiddleware.js';
import { downloadFileFromS3, startMultiPartUpload, uploadFileToS3 } from '../controllers/s3.controllers.js';

const uploadRouter = express.Router();
const downloadRouter = express.Router();
const multipartRouter = express.Router();


uploadRouter.post('/', uploadFileToS3);

multipartRouter.get('/' , startMultiPartUpload)

downloadRouter.get('/', jwtMiddleware, downloadFileFromS3);

export { uploadRouter, downloadRouter, multipartRouter };