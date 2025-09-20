use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;
use anchor_lang::system_program::{self, Transfer};

use crate::state::{HashAccount, VoteInfo, HASH_ACCOUNT_SPACE, VOTE_INFO_SPACE};

#[derive(Accounts)]
#[instruction(hash: [u8; 32])]
pub struct Vote<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = HASH_ACCOUNT_SPACE,
        seeds = [b"hash", hash.as_ref()],
        bump
    )]
    pub hash_account: Account<'info, HashAccount>,

    #[account(
        init,
        payer = user,
        space = VOTE_INFO_SPACE,
        seeds = [b"vote", hash_account.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub vote_info: Account<'info, VoteInfo>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn vote(ctx: Context<Vote>, hash: [u8; 32]) -> Result<()> {
    let hash_account = &mut ctx.accounts.hash_account;
    let vote_info = &mut ctx.accounts.vote_info;
    let user = &ctx.accounts.user;

    // If newly initialized, set defaults
    let is_new = hash_account.created_at == 0;
    if is_new {
        hash_account.hash = hash;
        hash_account.voters = 0;
        hash_account.created_at = Clock::get()?.unix_timestamp;
        hash_account.bump = ctx.bumps.hash_account;
    }

    // Record vote info (init guarantees it did not exist)
    vote_info.voter = user.key();
    vote_info.hash = hash;
    // each vote contributes exactly the rent-exempt minimum for the HashAccount
    let rent = Rent::get()?;
    let rent_min = rent.minimum_balance(HASH_ACCOUNT_SPACE);
    vote_info.amount = rent_min as u64;
    vote_info.bump = ctx.bumps.vote_info;

    // Transfer user's deposit into the hash account only if not just created.
    // When the account is created in this ix, Anchor already funded it with rent_min from `user`.
    if !is_new {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: user.to_account_info(),
                to: hash_account.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, rent_min)?;
    }

    // Increment voters
    hash_account.voters = hash_account
        .voters
        .checked_add(1)
        .ok_or(ProgramError::InvalidInstructionData)?;

    Ok(())
}
