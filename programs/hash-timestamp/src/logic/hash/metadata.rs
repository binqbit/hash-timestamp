use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

pub fn hash_account_metadata(target: &AccountInfo) -> Result<[u8; 32]> {
    let key_bytes = target.key.as_ref();
    let owner_bytes = target.owner.as_ref();
    let lamports_bytes = target.lamports().to_le_bytes();
    let executable_byte = [u8::from(target.executable)];
    let rent_epoch_bytes = target.rent_epoch.to_le_bytes();
    let data = target.try_borrow_data()?;
    let data_len_bytes = (data.len() as u64).to_le_bytes();

    let hash = hashv(&[
        key_bytes,
        owner_bytes,
        lamports_bytes.as_ref(),
        executable_byte.as_ref(),
        rent_epoch_bytes.as_ref(),
        data_len_bytes.as_ref(),
        &data,
    ])
    .to_bytes();
    drop(data);
    Ok(hash)
}
