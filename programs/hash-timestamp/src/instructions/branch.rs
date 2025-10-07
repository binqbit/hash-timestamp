use anchor_lang::prelude::*;

use anchor_lang::solana_program::program_error::ProgramError;
use anchor_lang::system_program::{self, Transfer};

use crate::logic::{
    assert_system_program_placeholder, derive_hash, derive_vote, ensure_hash_initialized,
    ensure_vote_matches, ensure_vote_owned, new_hash_state, new_vote_state,
};
use crate::state::{HashAccount, HASH_ACCOUNT_SPACE, VOTE_INFO_SPACE};
use crate::utils::{
    allocate_pda_account, close_account, minimum_hash_rent, minimum_vote_rent, move_lamports,
    write_account,
};
use crate::ErrorCode;

#[derive(Accounts)]
pub struct Branch<'info> {
    #[account(mut)]
    pub old_hash_account: Account<'info, HashAccount>,

    /// CHECK: Created inside using the derived PDA for the new hash.
    #[account(mut)]
    pub new_hash_account: AccountInfo<'info>,

    /// CHECK: Provided vote PDA for the caller on the old hash. May be uninitialized.
    #[account(mut)]
    pub old_vote_info: AccountInfo<'info>,

    /// CHECK: Created inside using the vote PDA for the new hash + caller.
    #[account(mut)]
    pub new_vote_info: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn branch(ctx: Context<Branch>, new_hash: [u8; 32], take_vote: bool) -> Result<()> {
    let new_hash_account = &ctx.accounts.new_hash_account;
    let old_vote_info = &ctx.accounts.old_vote_info;
    let new_vote_info = &ctx.accounts.new_vote_info;
    let user = &ctx.accounts.user;
    let system_program = ctx.accounts.system_program.to_account_info();

    let old_hash = &mut ctx.accounts.old_hash_account;
    let old_hash_key = old_hash.key();

    let hash_snapshot = ensure_hash_initialized(old_hash, ctx.program_id)?;
    let previous_block = hash_snapshot.previous_block();

    let new_hash_meta = derive_hash(ctx.program_id, &previous_block, &new_hash);
    require_keys_eq!(
        new_hash_meta.key,
        new_hash_account.key(),
        ErrorCode::InvalidHashSeeds
    );

    let user_key = user.key();
    let new_vote_meta = derive_vote(ctx.program_id, &new_hash_meta.key, &user_key);
    require_keys_eq!(
        new_vote_meta.key,
        new_vote_info.key(),
        ErrorCode::InvalidHashSeeds
    );

    let expected_old_vote = derive_vote(ctx.program_id, &old_hash_key, &user_key);
    let has_expected_old_vote = old_vote_info.key() == expected_old_vote.key;

    let mut migrate_amount = 0u64;
    let mut migrate_vote_lamports = 0u64;
    let mut will_close_old_hash = false;

    if take_vote {
        require!(has_expected_old_vote, ErrorCode::VoteAccountMissing);
        ensure_vote_owned(old_vote_info, ctx.program_id, ErrorCode::NoVoteToMigrate)?;

        let old_vote = ensure_vote_matches(old_vote_info, hash_snapshot.canonical_id(), &user_key)?;
        migrate_amount = old_vote.amount;
        migrate_vote_lamports = old_vote_info.lamports();
        will_close_old_hash = hash_snapshot.voters() == 1;
    } else if has_expected_old_vote && old_vote_info.owner == ctx.program_id {
        ensure_vote_matches(old_vote_info, hash_snapshot.canonical_id(), &user_key)?;
    } else if !has_expected_old_vote {
        assert_system_program_placeholder(old_vote_info)?;
    }

    let rent = Rent::get()?;
    let hash_rent = minimum_hash_rent(&rent);
    let vote_rent = minimum_vote_rent(&rent);

    if !take_vote {
        let transfer_ctx = CpiContext::new(
            system_program.clone(),
            Transfer {
                from: user.to_account_info(),
                to: new_hash_account.clone(),
            },
        );
        system_program::transfer(transfer_ctx, hash_rent)?;
    }

    let hash_seeds = new_hash_meta.seeds();
    allocate_pda_account(
        new_hash_account,
        ctx.program_id,
        HASH_ACCOUNT_SPACE,
        &hash_seeds,
        &system_program,
    )?;

    let hash_state = new_hash_state(previous_block, new_hash, new_hash_meta.bump)?;
    write_account(new_hash_account, &hash_state)?;

    if !take_vote {
        let vote_transfer_ctx = CpiContext::new(
            system_program.clone(),
            Transfer {
                from: user.to_account_info(),
                to: new_vote_info.clone(),
            },
        );
        system_program::transfer(vote_transfer_ctx, vote_rent)?;
    }

    let vote_seeds = new_vote_meta.seeds();
    allocate_pda_account(
        new_vote_info,
        ctx.program_id,
        VOTE_INFO_SPACE,
        &vote_seeds,
        &system_program,
    )?;

    let vote_state = new_vote_state(
        user_key,
        *new_hash_meta.canonical_id(),
        hash_rent,
        new_vote_meta.bump,
    );
    write_account(new_vote_info, &vote_state)?;

    if take_vote {
        if migrate_amount > 0 {
            let old_hash_info = old_hash.to_account_info();
            move_lamports(&old_hash_info, new_hash_account, migrate_amount)?;
        }

        if migrate_vote_lamports > 0 {
            move_lamports(old_vote_info, new_vote_info, migrate_vote_lamports)?;
        }

        old_hash.voters = old_hash
            .voters
            .checked_sub(1)
            .ok_or(ProgramError::InvalidInstructionData)?;

        let user_info = user.to_account_info();
        close_account(old_vote_info, &user_info)?;

        if will_close_old_hash {
            let old_hash_info = old_hash.to_account_info();
            close_account(&old_hash_info, &user_info)?;
        }
    }

    Ok(())
}
