import { IsIn, IsNotEmpty, IsUUID } from "class-validator";

export class VoteDto {
    @IsNotEmpty()
    @IsIn(['tabs', 'spaces'], { message: 'Choice must be either tabs or spaces' })
    choice: 'tabs' | 'spaces';
    
    @IsNotEmpty()
    @IsUUID('4', { message: 'user_id must be a valid UUID' })
    user_id: string;
}