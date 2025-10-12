use std::io::Cursor;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed, program_error::ProgramError, system_instruction,
};
use anchor_lang::system_program;
use anchor_lang::{AccountDeserialize, AccountSerialize};

use crate::logic::seeds::SeedBundle;

pub fn create_account_with_seeds<'info>(
    payer: &AccountInfo<'info>,
    new_account: &AccountInfo<'info>,
    space: usize,
    owner: &Pubkey,
    seeds: &SeedBundle,
    system_program_info: &AccountInfo<'info>,
) -> Result<u64> {
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);
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
        .map_err(|e| anchor_lang::error::Error::from(e))?;

    Ok(lamports)
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
