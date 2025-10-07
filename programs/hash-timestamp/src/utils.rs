use std::io::Cursor;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed, program_error::ProgramError, system_instruction,
};
use anchor_lang::system_program;
use anchor_lang::{AccountDeserialize, AccountSerialize};

use crate::state::{HASH_ACCOUNT_SPACE, VOTE_INFO_SPACE};

#[derive(Clone, Debug)]
pub struct SeedBundle {
    parts: Vec<Vec<u8>>,
}

impl SeedBundle {
    pub fn new(parts: Vec<Vec<u8>>) -> Self {
        Self { parts }
    }

    pub fn with_signer<F>(&self, f: F) -> Result<()>
    where
        F: FnOnce(&[&[&[u8]]]) -> std::result::Result<(), ProgramError>,
    {
        let seed_refs: Vec<&[u8]> = self.parts.iter().map(|p| p.as_slice()).collect();
        let signer = [seed_refs.as_slice()];
        f(&signer).map_err(Into::into)
    }
}

pub fn hash_seed_bundle(canonical_id: &[u8; 32], bump: u8) -> SeedBundle {
    SeedBundle::new(vec![b"hash".to_vec(), canonical_id.to_vec(), vec![bump]])
}

pub fn vote_seed_bundle(hash_key: &Pubkey, voter: &Pubkey, bump: u8) -> SeedBundle {
    SeedBundle::new(vec![
        b"vote".to_vec(),
        hash_key.to_bytes().to_vec(),
        voter.to_bytes().to_vec(),
        vec![bump],
    ])
}

pub fn create_account_with_seeds<'info>(
    payer: &AccountInfo<'info>,
    new_account: &AccountInfo<'info>,
    lamports: u64,
    space: usize,
    owner: &Pubkey,
    seeds: &SeedBundle,
    system_program_info: &AccountInfo<'info>,
) -> Result<()> {
    let ix = system_instruction::create_account(
        &payer.key(),
        &new_account.key(),
        lamports,
        space as u64,
        owner,
    );

    seeds
        .with_signer(|signer| {
            invoke_signed(
                &ix,
                &[
                    payer.clone(),
                    new_account.clone(),
                    system_program_info.clone(),
                ],
                signer,
            )
        })
        .map_err(Into::into)
}

pub fn allocate_pda_account<'info>(
    account: &AccountInfo<'info>,
    owner: &Pubkey,
    space: usize,
    seeds: &SeedBundle,
    system_program_info: &AccountInfo<'info>,
) -> Result<()> {
    let account_key = account.key();
    let allocate_ix = system_instruction::allocate(&account_key, space as u64);
    seeds.with_signer(|signer| {
        invoke_signed(
            &allocate_ix,
            &[account.clone(), system_program_info.clone()],
            signer,
        )
    })?;

    let assign_ix = system_instruction::assign(&account_key, owner);
    seeds
        .with_signer(|signer| {
            invoke_signed(
                &assign_ix,
                &[account.clone(), system_program_info.clone()],
                signer,
            )
        })
        .map_err(Into::into)
}

pub fn minimum_hash_rent(rent: &Rent) -> u64 {
    rent.minimum_balance(HASH_ACCOUNT_SPACE)
}

pub fn minimum_vote_rent(rent: &Rent) -> u64 {
    rent.minimum_balance(VOTE_INFO_SPACE)
}

pub fn read_account<T: AccountDeserialize>(account: &AccountInfo) -> Result<T> {
    let data = account.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let value = T::try_deserialize(&mut slice)?;
    drop(data);
    Ok(value)
}

pub fn write_account<T: AccountSerialize>(account: &AccountInfo, value: &T) -> Result<()> {
    let mut data = account.try_borrow_mut_data()?;
    let mut cursor = Cursor::new(&mut data[..]);
    value.try_serialize(&mut cursor)?;
    Ok(())
}

pub fn move_lamports(source: &AccountInfo, destination: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let source_balance = source.lamports();
    let destination_balance = destination.lamports();

    **source.try_borrow_mut_lamports()? = source_balance
        .checked_sub(amount)
        .ok_or(ProgramError::InvalidInstructionData)?;
    **destination.try_borrow_mut_lamports()? = destination_balance
        .checked_add(amount)
        .ok_or(ProgramError::InvalidInstructionData)?;

    Ok(())
}

pub fn close_account(account: &AccountInfo, recipient: &AccountInfo) -> Result<()> {
    let amount = account.lamports();
    move_lamports(account, recipient, amount)?;
    account.assign(&system_program::ID);
    account.resize(0).map_err(Into::into)
}
