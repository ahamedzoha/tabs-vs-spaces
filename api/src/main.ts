import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { credentials } from 'amqplib';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger("Bootstrap" + bootstrap.name);


  //Enable CORS for Frontend
  app.enableCors({
    origin: true, // Allow all origins for development
    credentials: true,
  })

  //Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, //Strip out unknown properties not in DTO
      forbidNonWhitelisted: true, //Throw an error if a non-whitelisted property is found
      transform: true, //Automatically transform the incoming data to the DTO type
    })
  )

  const PORT = config.get('PORT') ?? 3000;
  const ZONE = config.get('ZONE') ?? 'unknown';

  await app.listen(PORT);

  logger.log(`API Running on http://localhost:${PORT} (Zone: ${ZONE})`);
}
bootstrap();
