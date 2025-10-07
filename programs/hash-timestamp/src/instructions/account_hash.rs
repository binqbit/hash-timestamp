use anchor_lang::prelude::*;

use crate::logic::{
    derive_hash, derive_vote, genesis_previous_block, hash_account_metadata, new_hash_state,
    new_vote_state,
};
use crate::state::{HashType, HASH_ACCOUNT_SPACE, VOTE_INFO_SPACE};
use crate::utils::{
    create_account_with_seeds, minimum_hash_rent, minimum_vote_rent, write_account,
};
use crate::ErrorCode;

#[derive(Accounts)]
pub struct AccountHash<'info> {
    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub hash_account: AccountInfo<'info>,

    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub vote_info: AccountInfo<'info>,

    /// CHECK: Read-only; metadata is hashed but not otherwise trusted.
    pub target: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn account_hash(ctx: Context<AccountHash>) -> Result<()> {
    let hash_account = &ctx.accounts.hash_account;
    let vote_account = &ctx.accounts.vote_info;
    let target_account = &ctx.accounts.target;
    let payer = &ctx.accounts.payer;
    let payer_account = payer.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();
    let program_id = ctx.program_id;

    let metadata_hash = hash_account_metadata(target_account)?;
    let previous = genesis_previous_block();

    let hash_meta = derive_hash(program_id, &previous, &metadata_hash, HashType::Account);
    require_keys_eq!(hash_account.key(), hash_meta.key, ErrorCode::InvalidHashSeeds);
    require!(hash_account.lamports() == 0, ErrorCode::HashAlreadyExists);

    let vote_meta = derive_vote(program_id, &hash_meta.key, &payer.key());
    require_keys_eq!(vote_account.key(), vote_meta.key, ErrorCode::InvalidHashSeeds);
    require!(vote_account.lamports() == 0, ErrorCode::AlreadyVoted);

    let rent = Rent::get()?;
    let hash_rent = minimum_hash_rent(&rent);
    let vote_rent = minimum_vote_rent(&rent);

    let hash_seeds = hash_meta.seeds();
    create_account_with_seeds(
        &payer_account,
        hash_account,
        hash_rent,
        HASH_ACCOUNT_SPACE,
        program_id,
        &hash_seeds,
        &system_program,
    )?;

    let hash_state = new_hash_state(previous, metadata_hash, HashType::Account, hash_meta.bump)?;
    write_account(hash_account, &hash_state)?;

    let vote_seeds = vote_meta.seeds();
    create_account_with_seeds(
        &payer_account,
        vote_account,
        vote_rent,
        VOTE_INFO_SPACE,
        program_id,
        &vote_seeds,
        &system_program,
    )?;

    let vote_state = new_vote_state(
        payer.key(),
        *hash_meta.canonical_id(),
        hash_rent,
        vote_meta.bump,
    );
    write_account(vote_account, &vote_state)?;

    Ok(())
}
