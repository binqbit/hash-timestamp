use super::super::graph::build_proof_graph;
use super::*;

fn valid_branch_proof() -> [RestoreProofLink; 2] {
    let parent = RestoreProofLink {
        hash: [1; 32],
        source: HashSource::Hash,
        created_at: 10,
        params: None,
    };
    let parent_id = parent.canonical_id();
    let payload = [2; 32];
    let tip_hash = branch_hash_digest(&parent_id, 0, 10, 0, &payload);
    let tip = RestoreProofLink {
        hash: tip_hash,
        source: HashSource::Branch {
            previous_hash_id: parent_id,
            payload,
            generation: 1,
        },
        created_at: 11,
        params: Some(RestoreParameters::Branch {
            parent: RestoreHashFingerprint {
                hash: parent.hash,
                source_kind: 0,
                created_at: parent.created_at,
                generation: 0,
            },
        }),
    };
    [tip, parent]
}

#[test]
fn validates_a_dependency_anchored_branch() {
    let proof = valid_branch_proof();
    let graph = build_proof_graph(&proof).expect("structurally valid graph");
    let existing = HashSet::from([0]);

    validate_graph(&graph, &existing).expect("valid branch commitment");
}

#[test]
fn rejects_a_branch_generation_mismatch() {
    let mut proof = valid_branch_proof();
    let HashSource::Branch { generation, .. } = &mut proof[0].source else {
        panic!("branch fixture")
    };
    *generation = 2;
    let graph = build_proof_graph(&proof).expect("structurally valid graph");
    let existing = HashSet::from([0]);

    assert_protocol_error(
        validate_graph(&graph, &existing),
        ErrorCode::RestoreTipMismatch,
    );
}

#[test]
fn rejects_zero_historical_timestamp() {
    let proof = [RestoreProofLink {
        hash: [7; 32],
        source: HashSource::Hash,
        created_at: 0,
        params: None,
    }];
    let graph = build_proof_graph(&proof).expect("structurally valid graph");
    let existing = HashSet::from([0]);

    assert_protocol_error(
        validate_graph(&graph, &existing),
        ErrorCode::RestoreTimestampMismatch,
    );
}

fn assert_protocol_error(result: Result<()>, expected: ErrorCode) {
    match result {
        Err(anchor_lang::error::Error::AnchorError(error)) => {
            assert_eq!(error.error_code_number, u32::from(expected));
        }
        other => panic!("expected protocol error, got {other:?}"),
    }
}

fn fingerprint(link: &RestoreProofLink) -> RestoreHashFingerprint {
    RestoreHashFingerprint {
        hash: link.hash,
        source_kind: link.source.discriminator(),
        created_at: link.created_at,
        generation: link.source.generation(),
    }
}

fn branch(parent: &RestoreProofLink, payload: [u8; 32]) -> RestoreProofLink {
    let meta = fingerprint(parent);
    RestoreProofLink {
        hash: branch_hash_digest(
            &parent.canonical_id(),
            meta.source_kind,
            meta.created_at,
            meta.generation,
            &payload,
        ),
        source: HashSource::Branch {
            previous_hash_id: parent.canonical_id(),
            payload,
            generation: meta.generation + 1,
        },
        created_at: parent.created_at + 1,
        params: Some(RestoreParameters::Branch { parent: meta }),
    }
}

#[test]
fn coordinated_ancestor_timestamp_and_fingerprint_tampering_breaks_the_commitment() {
    let mut proof = valid_branch_proof();
    proof[1].created_at += 1;
    let Some(RestoreParameters::Branch { parent }) = &mut proof[0].params else {
        panic!("branch fixture");
    };
    parent.created_at = proof[1].created_at;
    let graph = build_proof_graph(&proof).unwrap();
    assert_protocol_error(
        validate_graph(&graph, &HashSet::from([0])),
        ErrorCode::RestoreTipMismatch,
    );
}

#[test]
fn every_account_snapshot_field_is_committed_even_when_the_record_exists() {
    let account = Pubkey::new_from_array([7; 32]);
    let snapshot = RestoreAccountSnapshot {
        owner: Pubkey::new_from_array([8; 32]),
        lamports: 42,
        executable: false,
        rent_epoch: 3,
        data: vec![1, 2, 3],
    };
    let hash = account_metadata_digest(
        &account,
        &snapshot.owner,
        snapshot.lamports,
        snapshot.executable,
        snapshot.rent_epoch,
        &snapshot.data,
    );
    for field in [
        "valid",
        "account",
        "owner",
        "lamports",
        "executable",
        "rent_epoch",
        "data",
    ] {
        let mut modified = snapshot.clone();
        let mut key = account;
        match field {
            "account" => key = Pubkey::new_from_array([9; 32]),
            "owner" => modified.owner = Pubkey::new_from_array([10; 32]),
            "lamports" => modified.lamports += 1,
            "executable" => modified.executable = true,
            "rent_epoch" => modified.rent_epoch += 1,
            "data" => modified.data[0] ^= 1,
            _ => {}
        }
        let proof = [RestoreProofLink {
            hash,
            source: HashSource::Account { account: key },
            created_at: 100,
            params: Some(RestoreParameters::Account {
                snapshot: Some(modified),
            }),
        }];
        let result = validate_graph(&build_proof_graph(&proof).unwrap(), &HashSet::from([0]));
        if field == "valid" {
            result.unwrap();
        } else {
            assert_protocol_error(result, ErrorCode::RestoreProofMismatch);
        }
    }
}

#[test]
fn account_snapshot_omission_requires_an_existing_record() {
    let proof = [RestoreProofLink {
        hash: [9; 32],
        source: HashSource::Account {
            account: Pubkey::new_from_array([8; 32]),
        },
        created_at: 100,
        params: Some(RestoreParameters::Account { snapshot: None }),
    }];
    let graph = build_proof_graph(&proof).unwrap();
    validate_graph(&graph, &HashSet::from([0])).unwrap();
    assert_protocol_error(
        validate_graph(&graph, &HashSet::new()),
        ErrorCode::RestoreAccountSnapshotMissing,
    );
}

fn aggregate_proof(pack: bool) -> Vec<RestoreProofLink> {
    let root = valid_branch_proof()[1].clone();
    let child = branch(&root, [3; 32]);
    let members = vec![fingerprint(&root), fingerprint(&child)];
    let (hash, source, params) = if pack {
        (
            compose_pack(
                &members
                    .iter()
                    .map(RestoreHashFingerprint::fingerprint)
                    .collect::<Vec<_>>(),
            )
            .unwrap(),
            HashSource::Pack,
            RestoreParameters::Pack { members },
        )
    } else {
        let composition = compose_batch(
            &members
                .iter()
                .map(|m| BatchMember {
                    canonical_id: m.canonical_id(),
                    fingerprint: m.fingerprint(),
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
        (
            composition.hash,
            composition.source,
            RestoreParameters::Batch { members },
        )
    };
    vec![
        RestoreProofLink {
            hash,
            source,
            created_at: 20,
            params: Some(params),
        },
        root,
        child,
    ]
}

fn aggregate_hash(pack: bool, members: &[RestoreHashFingerprint]) -> [u8; 32] {
    if pack {
        compose_pack(
            &members
                .iter()
                .map(RestoreHashFingerprint::fingerprint)
                .collect::<Vec<_>>(),
        )
        .unwrap()
    } else {
        compose_batch(
            &members
                .iter()
                .map(|meta| BatchMember {
                    canonical_id: meta.canonical_id(),
                    fingerprint: meta.fingerprint(),
                })
                .collect::<Vec<_>>(),
        )
        .unwrap()
        .hash
    }
}

#[test]
fn aggregate_commitments_reject_reordered_or_tampered_nonempty_fingerprints() {
    for pack in [false, true] {
        let proof = aggregate_proof(pack);
        validate_graph(&build_proof_graph(&proof).unwrap(), &HashSet::from([0])).unwrap();
        for field in ["order", "timestamp", "generation"] {
            let mut tampered = proof.clone();
            let members = match tampered[0].params.as_mut().unwrap() {
                RestoreParameters::Batch { members } | RestoreParameters::Pack { members } => {
                    members
                }
                _ => panic!("aggregate fixture"),
            };
            match field {
                "order" => members.swap(0, 1),
                "timestamp" => members[0].created_at += 1,
                "generation" => members[1].generation += 1,
                _ => unreachable!(),
            }
            if field == "timestamp" {
                // A self-consistent aggregate must still match its dependency's timestamp.
                // Otherwise digest mismatch alone would mask a missing metadata check.
                tampered[0].hash = aggregate_hash(pack, members);
            }
            // Keep Batch's source order consistent too, reaching digest recomputation.
            if field == "order" {
                if let HashSource::Batch { members } = &mut tampered[0].source {
                    members.swap(0, 1);
                }
            }
            assert_protocol_error(
                validate_graph(&build_proof_graph(&tampered).unwrap(), &HashSet::from([0])),
                ErrorCode::RestoreProofMismatch,
            );
        }
    }
}

#[test]
fn pack_rejects_duplicate_fingerprints_even_when_dependencies_are_present() {
    let mut proof = aggregate_proof(true);
    let Some(RestoreParameters::Pack { members }) = &mut proof[0].params else {
        panic!("pack fixture");
    };
    members.push(members[0].clone());
    // Make the digest consistent with duplicates: only uniqueness validation can reject it.
    proof[0].hash = aggregate_hash(true, members);
    assert_protocol_error(
        validate_graph(&build_proof_graph(&proof).unwrap(), &HashSet::from([0])),
        ErrorCode::RestoreProofMismatch,
    );
}

#[test]
fn shuffled_diamond_history_materializes_a_shared_ancestor_once_before_its_children() {
    use super::super::plan::RestorePlan;
    let root = valid_branch_proof()[1].clone();
    let left = branch(&root, [3; 32]);
    let right = branch(&root, [4; 32]);
    let members = vec![fingerprint(&left), fingerprint(&right)];
    let tip = RestoreProofLink {
        hash: compose_pack(
            &members
                .iter()
                .map(RestoreHashFingerprint::fingerprint)
                .collect::<Vec<_>>(),
        )
        .unwrap(),
        source: HashSource::Pack,
        created_at: 20,
        params: Some(RestoreParameters::Pack { members }),
    };
    let proof = [tip, right, root, left];
    let validated = ProofGraph::parse(&proof)
        .unwrap()
        .validate(&HashSet::from([0]))
        .unwrap();
    let plan = RestorePlan::build(validated, &HashSet::from([1, 2, 3]))
        .unwrap()
        .into_creations();
    assert_eq!(
        plan.iter().map(|item| item.proof_index).collect::<Vec<_>>(),
        vec![2, 3, 1]
    );
    for item in plan {
        assert!(core::ptr::eq(item.link, &proof[item.proof_index]));
    }
}
