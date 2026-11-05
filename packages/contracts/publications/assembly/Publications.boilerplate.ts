import { System, Protobuf, authority } from "@koinos/sdk-as";
import { publications } from "./proto/publications";

export class Publications {
  set_identity_contract(
    args: publications.set_identity_contract_arguments
  ): publications.set_identity_contract_result {
    // const address = args.address;

    // YOUR CODE HERE

    const res = new publications.set_identity_contract_result();

    return res;
  }

  set_relationships_contract(
    args: publications.set_relationships_contract_arguments
  ): publications.set_relationships_contract_result {
    // const address = args.address;

    // YOUR CODE HERE

    const res = new publications.set_relationships_contract_result();

    return res;
  }

  publish(args: publications.publish_arguments): publications.publish_result {
    // const author = args.author;
    // const post_id = args.post_id;
    // const previous_version = args.previous_version;
    // const sequence = args.sequence;
    // const audience = args.audience;
    // const audience_id = args.audience_id;
    // const epoch = args.epoch;
    // const envelope = args.envelope;
    // const content_hash = args.content_hash;
    // const media = args.media;
    // const reply_to = args.reply_to;
    // const idempotency_key = args.idempotency_key;
    // const device = args.device;
    // const poll = args.poll;
    // const collection_id = args.collection_id;
    // const gallery_only = args.gallery_only;
    // const reply_parent_version = args.reply_parent_version;
    // const reply_friends_epoch = args.reply_friends_epoch;

    // YOUR CODE HERE

    const res = new publications.publish_result();

    return res;
  }

  set_lifecycle(
    args: publications.set_lifecycle_arguments
  ): publications.set_lifecycle_result {
    // const author = args.author;
    // const post_id = args.post_id;
    // const version = args.version;
    // const state = args.state;
    // const reason = args.reason;
    // const replacement_id = args.replacement_id;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.set_lifecycle_result();

    return res;
  }

  react(args: publications.react_arguments): publications.react_result {
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const reaction = args.reaction;
    // const remove = args.remove;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.react_result();

    return res;
  }

  distribute_keys(
    args: publications.distribute_keys_arguments
  ): publications.distribute_keys_result {
    // const author = args.author;
    // const audience_id = args.audience_id;
    // const epoch = args.epoch;
    // const packages = args.packages;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.distribute_keys_result();

    return res;
  }

  record_cross_post(
    args: publications.record_cross_post_arguments
  ): publications.record_cross_post_result {
    // const author = args.author;
    // const idempotency_key = args.idempotency_key;
    // const adapter = args.adapter;
    // const state = args.state;
    // const external_ref = args.external_ref;
    // const post_id = args.post_id;
    // const manifest_hash = args.manifest_hash;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.record_cross_post_result();

    return res;
  }

  get_post(
    args: publications.get_post_arguments
  ): publications.get_post_result {
    // const post_id = args.post_id;

    // YOUR CODE HERE

    const res = new publications.get_post_result();
    // res.value = ;

    return res;
  }

  get_music_vote_target(
    args: publications.get_music_vote_target_arguments
  ): publications.get_music_vote_target_result {
    // const id = args.id;
    // const viewer = args.viewer;

    // YOUR CODE HERE

    const res = new publications.get_music_vote_target_result();
    // res.value = ;

    return res;
  }

  get_author_state(
    args: publications.get_author_state_arguments
  ): publications.get_author_state_result {
    // const author = args.author;

    // YOUR CODE HERE

    const res = new publications.get_author_state_result();
    // res.value = ;

    return res;
  }

  get_post_by_idempotency_key(
    args: publications.get_post_by_idempotency_key_arguments
  ): publications.get_post_by_idempotency_key_result {
    // const author = args.author;
    // const idempotency_key = args.idempotency_key;

    // YOUR CODE HERE

    const res = new publications.get_post_by_idempotency_key_result();
    // res.value = ;

    return res;
  }

  get_limits(
    args: publications.get_limits_arguments
  ): publications.get_limits_result {
    // YOUR CODE HERE

    const res = new publications.get_limits_result();
    // res.value = ;

    return res;
  }

  get_dependencies(
    args: publications.get_dependencies_arguments
  ): publications.get_dependencies_result {
    // YOUR CODE HERE

    const res = new publications.get_dependencies_result();
    // res.identity = ;
    // res.relationships = ;

    return res;
  }

  set_token_contract(
    args: publications.set_token_contract_arguments
  ): publications.set_token_contract_result {
    // const address = args.address;

    // YOUR CODE HERE

    const res = new publications.set_token_contract_result();

    return res;
  }

  get_token_contract(
    args: publications.get_token_contract_arguments
  ): publications.get_token_contract_result {
    // YOUR CODE HERE

    const res = new publications.get_token_contract_result();
    // res.value = ;

    return res;
  }

  answer_poll(
    args: publications.answer_poll_arguments
  ): publications.answer_poll_result {
    // const actor = args.actor;
    // const post_id = args.post_id;
    // const option = args.option;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.answer_poll_result();

    return res;
  }

  get_poll(
    args: publications.get_poll_arguments
  ): publications.get_poll_result {
    // const post_id = args.post_id;
    // const viewer = args.viewer;

    // YOUR CODE HERE

    const res = new publications.get_poll_result();
    // res.value = ;
    // res.ballot = ;
    // res.now = ;

    return res;
  }

  begin_photo(
    args: publications.begin_photo_arguments
  ): publications.begin_photo_result {
    // const owner = args.owner;
    // const id = args.id;
    // const digest = args.digest;
    // const size = args.size;
    // const chunk_hashes = args.chunk_hashes;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.begin_photo_result();

    return res;
  }

  append_photo(
    args: publications.append_photo_arguments
  ): publications.append_photo_result {
    // const owner = args.owner;
    // const id = args.id;
    // const index = args.index;
    // const data = args.data;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.append_photo_result();

    return res;
  }

  get_photo(
    args: publications.get_photo_arguments
  ): publications.get_photo_result {
    // const id = args.id;

    // YOUR CODE HERE

    const res = new publications.get_photo_result();
    // res.value = ;

    return res;
  }

  get_library_version(
    args: publications.get_library_version_arguments
  ): publications.get_library_version_result {
    // YOUR CODE HERE

    const res = new publications.get_library_version_result();
    // res.version = ;

    return res;
  }

  save_collection(
    args: publications.save_collection_arguments
  ): publications.save_collection_result {
    // const owner = args.owner;
    // const id = args.id;
    // const previous_revision = args.previous_revision;
    // const kind = args.kind;
    // const audience = args.audience;
    // const members = args.members;
    // const envelope = args.envelope;
    // const closed = args.closed;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.save_collection_result();

    return res;
  }

  get_collection(
    args: publications.get_collection_arguments
  ): publications.get_collection_result {
    // const id = args.id;

    // YOUR CODE HERE

    const res = new publications.get_collection_result();
    // res.value = ;

    return res;
  }

  set_album_item(
    args: publications.set_album_item_arguments
  ): publications.set_album_item_result {
    // const owner = args.owner;
    // const collection_id = args.collection_id;
    // const id = args.id;
    // const epoch = args.epoch;
    // const previous_revision = args.previous_revision;
    // const envelope = args.envelope;
    // const removed = args.removed;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.set_album_item_result();

    return res;
  }

  get_album_item(
    args: publications.get_album_item_arguments
  ): publications.get_album_item_result {
    // const collection_id = args.collection_id;
    // const id = args.id;

    // YOUR CODE HERE

    const res = new publications.get_album_item_result();
    // res.value = ;

    return res;
  }

  get_music_art_version(
    args: publications.get_music_art_version_arguments
  ): publications.get_music_art_version_result {
    // YOUR CODE HERE

    const res = new publications.get_music_art_version_result();
    // res.version = ;

    return res;
  }

  set_music_cover(
    args: publications.set_music_cover_arguments
  ): publications.set_music_cover_result {
    // const owner = args.owner;
    // const id = args.id;
    // const cover = args.cover;
    // const expected_revision = args.expected_revision;

    // YOUR CODE HERE

    const res = new publications.set_music_cover_result();

    return res;
  }

  set_music_config(
    args: publications.set_music_config_arguments
  ): publications.set_music_config_result {
    // const recipient = args.recipient;
    // const rate_per_mb = args.rate_per_mb;
    // const max_bytes = args.max_bytes;
    // const enabled = args.enabled;
    // const flat_fee = args.flat_fee;

    // YOUR CODE HERE

    const res = new publications.set_music_config_result();

    return res;
  }

  get_music_config(
    args: publications.get_music_config_arguments
  ): publications.get_music_config_result {
    // YOUR CODE HERE

    const res = new publications.get_music_config_result();
    // res.value = ;

    return res;
  }

  begin_music(
    args: publications.begin_music_arguments
  ): publications.begin_music_result {
    // const owner = args.owner;
    // const id = args.id;
    // const digest = args.digest;
    // const size = args.size;
    // const chunk_hashes = args.chunk_hashes;
    // const title = args.title;
    // const mime = args.mime;
    // const duration_ms = args.duration_ms;
    // const config_revision = args.config_revision;
    // const max_fee = args.max_fee;
    // const payer = args.payer;
    // const device = args.device;
    // const artist = args.artist;
    // const description = args.description;
    // const audience = args.audience;
    // const group_id = args.group_id;
    // const encrypted = args.encrypted;
    // const nonce = args.nonce;
    // const owner_key = args.owner_key;
    // const unlock_price = args.unlock_price;
    // const key_hash = args.key_hash;
    // const cover = args.cover;
    // const clip_kind = args.clip_kind;
    // const gzip_original_size = args.gzip_original_size;

    // YOUR CODE HERE

    const res = new publications.begin_music_result();

    return res;
  }

  append_music(
    args: publications.append_music_arguments
  ): publications.append_music_result {
    // const owner = args.owner;
    // const id = args.id;
    // const index = args.index;
    // const data = args.data;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.append_music_result();

    return res;
  }

  get_music(
    args: publications.get_music_arguments
  ): publications.get_music_result {
    // const id = args.id;

    // YOUR CODE HERE

    const res = new publications.get_music_result();
    // res.value = ;

    return res;
  }

  get_music_chunk(
    args: publications.get_music_chunk_arguments
  ): publications.get_music_chunk_result {
    // const id = args.id;
    // const index = args.index;

    // YOUR CODE HERE

    const res = new publications.get_music_chunk_result();
    // res.data = ;

    return res;
  }

  get_music_chunks(
    args: publications.get_music_chunks_arguments
  ): publications.get_music_chunks_result {
    // const id = args.id;
    // const index = args.index;
    // const count = args.count;

    // YOUR CODE HERE

    const res = new publications.get_music_chunks_result();
    // res.chunks = ;

    return res;
  }

  list_music(
    args: publications.list_music_arguments
  ): publications.list_music_result {
    // const owner = args.owner;
    // const after = args.after;
    // const group_id = args.group_id;

    // YOUR CODE HERE

    const res = new publications.list_music_result();
    // res.ids = ;

    return res;
  }

  append_music_batch(
    args: publications.append_music_batch_arguments
  ): publications.append_music_batch_result {
    // const owner = args.owner;
    // const id = args.id;
    // const index = args.index;
    // const chunks = args.chunks;
    // const device = args.device;

    // YOUR CODE HERE

    const res = new publications.append_music_batch_result();

    return res;
  }

  request_music_access(
    args: publications.request_music_access_arguments
  ): publications.request_music_access_result {
    // const buyer = args.buyer;
    // const id = args.id;
    // const max_price = args.max_price;

    // YOUR CODE HERE

    const res = new publications.request_music_access_result();

    return res;
  }

  grant_music_access(
    args: publications.grant_music_access_arguments
  ): publications.grant_music_access_result {
    // const owner = args.owner;
    // const id = args.id;
    // const buyer = args.buyer;
    // const key = args.key;

    // YOUR CODE HERE

    const res = new publications.grant_music_access_result();

    return res;
  }

  refund_music_access(
    args: publications.refund_music_access_arguments
  ): publications.refund_music_access_result {
    // const buyer = args.buyer;
    // const id = args.id;

    // YOUR CODE HERE

    const res = new publications.refund_music_access_result();

    return res;
  }

  get_music_access(
    args: publications.get_music_access_arguments
  ): publications.get_music_access_result {
    // const id = args.id;
    // const buyer = args.buyer;

    // YOUR CODE HERE

    const res = new publications.get_music_access_result();
    // res.value = ;
    // res.eligible = ;
    // res.now = ;

    return res;
  }

  list_music_requests(
    args: publications.list_music_requests_arguments
  ): publications.list_music_requests_result {
    // const owner = args.owner;
    // const after = args.after;

    // YOUR CODE HERE

    const res = new publications.list_music_requests_result();
    // res.items = ;
    // res.next = ;

    return res;
  }

  comment_music(
    args: publications.comment_music_arguments
  ): publications.comment_music_result {
    // const author = args.author;
    // const id = args.id;
    // const comment_id = args.comment_id;
    // const body = args.body;
    // const nonce = args.nonce;
    // const reply_to = args.reply_to;

    // YOUR CODE HERE

    const res = new publications.comment_music_result();

    return res;
  }

  delete_music_comment(
    args: publications.delete_music_comment_arguments
  ): publications.delete_music_comment_result {
    // const author = args.author;
    // const id = args.id;
    // const comment_id = args.comment_id;

    // YOUR CODE HERE

    const res = new publications.delete_music_comment_result();

    return res;
  }

  list_music_comments(
    args: publications.list_music_comments_arguments
  ): publications.list_music_comments_result {
    // const id = args.id;
    // const after = args.after;

    // YOUR CODE HERE

    const res = new publications.list_music_comments_result();
    // res.items = ;
    // res.next = ;

    return res;
  }
}
