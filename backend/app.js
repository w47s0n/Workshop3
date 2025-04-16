import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; 

const REGION = process.env.AWS_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });
const sns = new SNSClient({ region: REGION });
const dynamoDB = new DynamoDBClient({ region: REGION });

const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;
const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Validate environment variables
const validateEnv = () => {
  const missingVars = [];
  
  if (!SNS_TOPIC_ARN) missingVars.push('SNS_TOPIC_ARN');
  if (!DYNAMODB_TABLE_NAME) missingVars.push('DYNAMODB_TABLE_NAME');
  if (!BUCKET_NAME) missingVars.push('S3_BUCKET_NAME');
  
  if (missingVars.length > 0) {
    const errorMsg = `Missing required environment variables: ${missingVars.join(', ')}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
};

export const handler = async (event) => {
  try {
    // Validate environment variables before processing
    validateEnv();
    
    const { filename, contentType, email } = JSON.parse(event.body);

    // Generate pre-signed URL
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: filename,
      ContentType: contentType,
    };
    const command = new PutObjectCommand(uploadParams);
    
    const uploadURL = await getSignedUrl(s3, command, { expiresIn: 60 });
    
    // Save data to DynamoDB
    const timestamp = new Date().toISOString();
    const item = {
      email: { S: email },
      url: { S: `https://${BUCKET_NAME}.s3.amazonaws.com/${filename}` },
      datetime: { S: timestamp },
    };

    await dynamoDB.send(new PutItemCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Item: item,
    }));

    // Send SNS notification
    const snsMessage = `A new file named ${filename} was uploaded by ${email}.`;
    await sns.send(new PublishCommand({
      Message: snsMessage,
      TopicArn: SNS_TOPIC_ARN,
    }));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ uploadURL }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
