import express from 'express'
import jwtMiddleware from '../middleware/jwtMiddleware.js';
import { completeMultiPartUpload, downloadFileFromS3, startMultiPartUpload, uploadFileToS3 } from '../controllers/s3.controllers.js';

const uploadRouter = express.Router();
const downloadRouter = express.Router();
const multipartRouter = express.Router();


uploadRouter.post('/', uploadFileToS3);

multipartRouter.post('/' , startMultiPartUpload)

multipartRouter.post('/complete', completeMultiPartUpload)

downloadRouter.post('/', jwtMiddleware, downloadFileFromS3);



export { uploadRouter, downloadRouter, multipartRouter };