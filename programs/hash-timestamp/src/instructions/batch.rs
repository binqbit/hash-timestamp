use anchor_lang::prelude::*;

use crate::logic::{
    compose_batch, derive_hash, derive_vote, new_hash_state, new_vote_state, BatchMember,
};
use crate::state::{HashAccount, HashType, HASH_ACCOUNT_SPACE, VOTE_INFO_SPACE};
use crate::utils::{
    create_account_with_seeds, minimum_hash_rent, minimum_vote_rent, read_account, write_account,
};
use crate::ErrorCode;

#[derive(Accounts)]
pub struct Batch<'info> {
    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub batch_hash_account: AccountInfo<'info>,

    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub vote_info: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn batch(ctx: Context<Batch>) -> Result<()> {
    let batch_account = &ctx.accounts.batch_hash_account;
    let vote_account = &ctx.accounts.vote_info;
    let payer = &ctx.accounts.payer;
    let payer_account = payer.to_account_info();
    let payer_key = payer.key();
    let system_program = ctx.accounts.system_program.to_account_info();
    let program_id = ctx.program_id;

    let mut members: Vec<BatchMember> = Vec::with_capacity(ctx.remaining_accounts.len());

    for account_info in ctx.remaining_accounts.iter() {
        require!(
            *account_info.owner == *program_id,
            ErrorCode::BatchMemberWrongProgram
        );

        let hash_account: HashAccount = read_account(account_info)?;
        hash_account.verify_account(program_id, account_info)?;
        require!(hash_account.created_at != 0, ErrorCode::HashNotFound);

        members.push(BatchMember {
            canonical_id: hash_account.canonical_id(),
            created_at: hash_account.created_at,
            generation: hash_account.current_generation(),
        });
    }

    let composition = compose_batch(&members)?;

    let batch_key = batch_account.key();
    let derived = derive_hash(
        program_id,
        &composition.previous,
        &composition.hash,
        HashType::Batch,
    );

    require_keys_eq!(
        derived.key,
        batch_account.key(),
        ErrorCode::InvalidHashSeeds
    );
    require!(batch_account.lamports() == 0, ErrorCode::HashAlreadyExists);

    let vote_meta = derive_vote(program_id, &batch_key, &payer_key);
    require_keys_eq!(
        vote_meta.key,
        vote_account.key(),
        ErrorCode::InvalidHashSeeds
    );
    require!(vote_account.lamports() == 0, ErrorCode::AlreadyVoted);

    let rent = Rent::get()?;
    let hash_rent = minimum_hash_rent(&rent);
    let vote_rent = minimum_vote_rent(&rent);

    let seeds = derived.seeds();
    create_account_with_seeds(
        &payer_account,
        batch_account,
        hash_rent,
        HASH_ACCOUNT_SPACE,
        program_id,
        &seeds,
        &system_program,
    )?;

    let hash_state = new_hash_state(
        composition.previous,
        composition.hash,
        HashType::Batch,
        derived.bump,
    )?;
    write_account(batch_account, &hash_state)?;

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
        payer_key,
        *derived.canonical_id(),
        hash_rent,
        vote_meta.bump,
    );
    write_account(vote_account, &vote_state)?;

    Ok(())
}
