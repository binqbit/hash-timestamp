use anchor_lang::prelude::*;

use anchor_lang::solana_program::program_error::ProgramError;

use crate::logic::ensure_hash_initialized;
use crate::state::{HashAccount, VoteInfo};
use crate::utils::move_lamports;
use crate::ErrorCode;

#[derive(Accounts)]
pub struct Unvote<'info> {
    #[account(mut)]
    pub hash_account: Account<'info, HashAccount>,

    #[account(
        mut,
        close = user,
        seeds = [b"vote", hash_account.key().as_ref(), user.key().as_ref()],
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
    if amount > 0 {
        let hash_info = hash_account.to_account_info();
        let user_info = user.to_account_info();
        move_lamports(&hash_info, &user_info, amount)?;
    }

    hash_account.voters = hash_account
        .voters
        .checked_sub(1)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if hash_account.voters == 0 {
        let hash_info = hash_account.to_account_info();
        let user_info = user.to_account_info();
        let remaining = hash_info.lamports();
        move_lamports(&hash_info, &user_info, remaining)?;

        let mut data = hash_info.try_borrow_mut_data()?;
        for byte in data.iter_mut() {
            *byte = 0;
        }
    }

    Ok(())
}
