import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { VotesService } from './votes.service';
import { VoteDto } from './dto/vote.dto';

@Controller('votes')
export class VotesController {

    private readonly logger = new Logger(VotesController.name);

    constructor(private readonly votesService: VotesService) {}

    @Post()
    @HttpCode(HttpStatus.ACCEPTED) // 202 Accepted
    async vote(@Body() voteDto: VoteDto) {
        this.logger.log(`Received vote: ${voteDto.choice} from user ${voteDto.user_id}`);
        return this.votesService.ingestVote(voteDto);
    }

}
