use anchor_lang::prelude::*;

use crate::runtime::{hash_record, vote_record};
use crate::state::{HashAccount, VoteInfo};

#[derive(Accounts)]
pub struct Unvote<'info> {
    #[account(mut)]
    pub hash_account: Account<'info, HashAccount>,

    #[account(mut)]
    pub vote_info: Account<'info, VoteInfo>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn unvote(ctx: Context<Unvote>) -> Result<()> {
    let accounts = ctx.accounts;
    let snapshot = hash_record::snapshot(ctx.program_id, &accounts.hash_account)?;
    let vote = vote_record::validate(
        ctx.program_id,
        &accounts.vote_info,
        snapshot.canonical_id(),
        &accounts.user.key(),
    )?;
    let was_last_voter = vote.release(&mut accounts.hash_account, &accounts.user)?;
    crate::debug_log!(
        "checkpoint=instruction.done instruction=unvote hash={} voter={} closed={}",
        accounts.hash_account.key(),
        accounts.user.key(),
        was_last_voter
    );
    Ok(())
}
