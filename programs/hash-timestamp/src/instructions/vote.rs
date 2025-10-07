use anchor_lang::prelude::*;

use anchor_lang::solana_program::program_error::ProgramError;
use anchor_lang::system_program::{self, Transfer};

use crate::logic::ensure_hash_initialized;
use crate::state::{HashAccount, VoteInfo, VOTE_INFO_SPACE};
use crate::utils::minimum_hash_rent;

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub hash_account: Account<'info, HashAccount>,

    #[account(
        init,
        payer = user,
        space = VOTE_INFO_SPACE,
        seeds = [b"vote", hash_account.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub vote_info: Account<'info, VoteInfo>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn vote(ctx: Context<Vote>) -> Result<()> {
    let hash_account = &mut ctx.accounts.hash_account;
    let vote_info = &mut ctx.accounts.vote_info;
    let user = &ctx.accounts.user;

    let hash_snapshot = ensure_hash_initialized(hash_account, ctx.program_id)?;

    let rent = Rent::get()?;
    let hash_rent = minimum_hash_rent(&rent);

    let transfer_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: user.to_account_info(),
            to: hash_account.to_account_info(),
        },
    );
    system_program::transfer(transfer_ctx, hash_rent)?;

    hash_account.voters = hash_account
        .voters
        .checked_add(1)
        .ok_or(ProgramError::InvalidInstructionData)?;

    vote_info.voter = user.key();
    vote_info.hash_id = *hash_snapshot.canonical_id();
    vote_info.amount = hash_rent;
    vote_info.bump = ctx.bumps.vote_info;

    Ok(())
}
