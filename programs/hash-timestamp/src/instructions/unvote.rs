use anchor_lang::prelude::*;

use crate::logic::{ensure_hash_initialized, release_vote_from_hash};
use crate::state::{HashAccount, VoteInfo};
use crate::ErrorCode;

#[derive(Accounts)]
pub struct Unvote<'info> {
    #[account(mut)]
    pub hash_account: Account<'info, HashAccount>,

    #[account(
        mut,
        seeds = [b"vote", user.key().as_ref(), hash_account.canonical_id().as_ref()],
        bump = vote_info.bump,
    )]
    pub vote_info: Account<'info, VoteInfo>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn unvote(ctx: Context<Unvote>) -> Result<()> {
    let hash_account = &mut ctx.accounts.hash_account;
    let vote_info = &mut ctx.accounts.vote_info;
    let user = &ctx.accounts.user;

    let hash_snapshot = ensure_hash_initialized(hash_account, ctx.program_id)?;

    require!(
        vote_info.hash_id == *hash_snapshot.canonical_id(),
        ErrorCode::InvalidHashSeeds
    );
    require_keys_eq!(vote_info.voter, user.key(), ErrorCode::NotVoter);

    let amount = vote_info.amount;
    let user_info = user.to_account_info();
    let vote_account_info = vote_info.to_account_info();
    release_vote_from_hash(hash_account, &vote_account_info, &user_info, amount)?;

    Ok(())
}
