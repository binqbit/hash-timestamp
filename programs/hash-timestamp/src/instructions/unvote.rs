use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;

use crate::state::{HashAccount, VoteInfo};
use crate::ErrorCode;

#[derive(Accounts)]
#[instruction(hash: [u8; 32])]
pub struct Unvote<'info> {
    #[account(
        mut,
        seeds = [b"hash", hash.as_ref()],
        bump = hash_account.bump,
        constraint = hash_account.hash == hash @ ErrorCode::InvalidHashSeeds,
    )]
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

pub fn unvote(ctx: Context<Unvote>, hash: [u8; 32]) -> Result<()> {
    let hash_account = &mut ctx.accounts.hash_account;
    let vote_info = &mut ctx.accounts.vote_info;
    let user = &ctx.accounts.user;

    // Sanity
    require_keys_eq!(vote_info.voter, user.key(), ErrorCode::NotVoter);
    require!(vote_info.hash == hash, ErrorCode::InvalidHashSeeds);

    // Return the user's deposit from the hash account
    let amount = vote_info.amount;
    if amount > 0 {
        // Move lamports back to the user without CPI; program-owned accounts cannot invoke SystemProgram::transfer.
        let hash_info = hash_account.to_account_info();
        let user_info = user.to_account_info();
        let hash_lamports = hash_info.lamports();
        let user_lamports = user_info.lamports();
        **hash_info.try_borrow_mut_lamports()? = hash_lamports
            .checked_sub(amount)
            .ok_or(ProgramError::InvalidInstructionData)?;
        **user_info.try_borrow_mut_lamports()? = user_lamports
            .checked_add(amount)
            .ok_or(ProgramError::InvalidInstructionData)?;
    }

    // Decrement voters
    hash_account.voters = hash_account
        .voters
        .checked_sub(1)
        .ok_or(ProgramError::InvalidInstructionData)?;

    // If no voters remain, close the hash account automatically
    if hash_account.voters == 0 {
        // Drain any residual lamports (should be zero) to the user and zero the data
        let remaining = hash_account.to_account_info().lamports();
        **hash_account.to_account_info().try_borrow_mut_lamports()? -= remaining;
        **user.to_account_info().try_borrow_mut_lamports()? += remaining;

        // Zero the data to mark as closed
        let account_info = hash_account.to_account_info();
        let mut data = account_info.try_borrow_mut_data()?;
        for b in data.iter_mut() {
            *b = 0;
        }
    }

    Ok(())
}
