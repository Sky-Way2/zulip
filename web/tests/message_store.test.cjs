"use strict";

const assert = require("node:assert/strict");

const {mock_esm, set_global, zrequire} = require("./lib/namespace.cjs");
const {run_test, noop} = require("./lib/test.cjs");
const blueslip = require("./lib/zblueslip.cjs");

mock_esm("../src/settings_data", {
    user_can_access_all_other_users: () => true,
});

mock_esm("../src/stream_topic_history", {
    add_message: noop,
});

mock_esm("../src/recent_senders", {
    process_stream_message: noop,
    process_private_message: noop,
});

set_global("document", "document-stub");

const util = zrequire("util");
const people = zrequire("people");
const pm_conversations = zrequire("pm_conversations");
const message_helper = zrequire("message_helper");
const message_store = zrequire("message_store");
const message_user_ids = zrequire("message_user_ids");
const {set_realm} = zrequire("state_data");
const {initialize_user_settings} = zrequire("user_settings");

set_realm({});
initialize_user_settings({user_settings: {}});

const denmark = {
    subscribed: false,
    name: "Denmark",
    stream_id: 20,
};

const devel = {
    subscribed: true,
    name: "Devel",
    stream_id: 21,
};

const me = {
    email: "me@example.com",
    user_id: 101,
    full_name: "Me Myself",
};

const alice = {
    email: "alice@example.com",
    user_id: 102,
    full_name: "Alice",
};

const bob = {
    email: "bob@example.com",
    user_id: 103,
    full_name: "Bob",
};

const cindy = {
    email: "cindy@example.com",
    user_id: 104,
    full_name: "Cindy",
};

const denise = {
    email: "denise@example.com",
    user_id: 105,
    full_name: "Denise ",
};

people.add_active_user(me);
people.add_active_user(alice);
people.add_active_user(bob);
people.add_active_user(cindy);
people.add_active_user(denise);

people.initialize_current_user(me.user_id);

function convert_recipients(people) {
    // Display_recipient uses `id` for user_ids.
    return people.map((p) => ({
        email: p.email,
        id: p.user_id,
        full_name: p.full_name,
    }));
}

function test(label, f) {
    run_test(label, (helpers) => {
        message_store.clear_for_testing();
        message_user_ids.clear_for_testing();
        f(helpers);
    });
}

test("process_new_message", () => {
    let message = {
        sender_email: "me@example.com",
        sender_id: me.user_id,
        type: "private",
        display_recipient: convert_recipients([me, bob, cindy]),
        flags: ["has_alert_word"],
        is_me_message: false,
        id: 2067,
    };
    message = message_helper.process_new_message(message);

    assert.deepEqual(message_user_ids.user_ids().sort(), [me.user_id, bob.user_id, cindy.user_id]);

    assert.equal(message.is_private, true);
    assert.equal(message.reply_to, "bob@example.com,cindy@example.com");
    assert.equal(message.to_user_ids, "103,104");
    assert.equal(message.display_reply_to, "Bob, Cindy");
    assert.equal(message.alerted, true);
    assert.equal(message.is_me_message, false);

    const retrieved_message = message_store.get(2067);
    assert.equal(retrieved_message, message);

    // access cached previous message, and test match subject/content
    message = {
        id: 2067,
        match_subject: "topic foo",
        match_content: "bar content",
    };
    message = message_helper.process_new_message(message);

    assert.equal(message.reply_to, "bob@example.com,cindy@example.com");
    assert.equal(message.to_user_ids, "103,104");
    assert.equal(message.display_reply_to, "Bob, Cindy");
    assert.equal(util.get_match_topic(message), "topic foo");
    assert.equal(message.match_content, "bar content");

    message = {
        sender_email: denise.email,
        sender_id: denise.user_id,
        type: "stream",
        display_recipient: "Zoolippy",
        topic: "cool thing",
        subject: "the_subject",
        id: 2068,
    };

    message = message_helper.process_new_message(message);
    assert.equal(message.reply_to, "denise@example.com");
    assert.deepEqual(message.flags, undefined);
    assert.equal(message.alerted, false);

    assert.deepEqual(message_user_ids.user_ids().sort(), [
        me.user_id,
        bob.user_id,
        cindy.user_id,
        denise.user_id,
    ]);
});

test("message_booleans_parity", () => {
    // We have two code paths that update/set message booleans.
    // This test asserts that both have identical behavior for the
    // flags common between them.
    const assert_bool_match = (flags, expected_message) => {
        let set_message = {topic: "convert_raw_message_to_message_with_booleans", flags};
        const update_message = {topic: "update_booleans"};
        set_message = message_store.convert_raw_message_to_message_with_booleans(set_message);
        message_store.update_booleans(update_message, flags);
        for (const key of Object.keys(expected_message)) {
            assert.equal(
                set_message[key],
                expected_message[key],
                `'${key}' != ${expected_message[key]}`,
            );
            assert.equal(update_message[key], expected_message[key]);
        }
        assert.equal(set_message.topic, "convert_raw_message_to_message_with_booleans");
        assert.equal(update_message.topic, "update_booleans");
    };

    assert_bool_match(["stream_wildcard_mentioned"], {
        mentioned: true,
        mentioned_me_directly: false,
        stream_wildcard_mentioned: true,
        topic_wildcard_mentioned: false,
        alerted: false,
    });

    assert_bool_match(["topic_wildcard_mentioned"], {
        mentioned: true,
        mentioned_me_directly: false,
        stream_wildcard_mentioned: false,
        topic_wildcard_mentioned: true,
        alerted: false,
    });

    assert_bool_match(["mentioned"], {
        mentioned: true,
        mentioned_me_directly: true,
        stream_wildcard_mentioned: false,
        topic_wildcard_mentioned: false,
        alerted: false,
    });

    assert_bool_match(["has_alert_word"], {
        mentioned: false,
        mentioned_me_directly: false,
        stream_wildcard_mentioned: false,
        topic_wildcard_mentioned: false,
        alerted: true,
    });
});

test("errors", ({disallow_rewire}) => {
    // Test a user that doesn't exist
    let message = {
        type: "private",
        display_recipient: [{id: 92714}],
    };

    blueslip.expect("error", "Unknown user_id in maybe_get_user_by_id", 1);
    blueslip.expect("error", "Unknown user id", 1); // From person.js

    // Expect each to throw two blueslip errors
    // One from message_store.ts, one from person.js
    const emails = message_store.get_pm_emails(message);
    assert.equal(emails, "?");

    assert.throws(
        () => {
            message_store.get_pm_full_names(people.pm_with_user_ids(message));
        },
        {
            name: "Error",
            message: "Unknown user_id in get_by_user_id: 92714",
        },
    );

    message = {
        type: "stream",
        display_recipient: [{}],
    };

    // This should early return and not run pm_conversations.set_partner
    disallow_rewire(pm_conversations, "set_partner");
    pm_conversations.process_message(message);
});

test("reify_message_id", () => {
    const message = {type: "private", id: 500};

    message_store.update_message_cache(message);
    assert.equal(message_store.get_cached_message(500), message);

    message_store.reify_message_id({old_id: 500, new_id: 501});
    assert.equal(message_store.get_cached_message(500), undefined);
    assert.equal(message_store.get_cached_message(501), message);
});

test("update_booleans", () => {
    const message = {};

    // First, test fields that we do actually want to update.
    message.mentioned = false;
    message.mentioned_me_directly = false;
    message.stream_wildcard_mentioned = false;
    message.topic_wildcard_mentioned = false;
    message.alerted = false;

    let flags = ["mentioned", "has_alert_word", "read"];
    message_store.update_booleans(message, flags);
    assert.equal(message.mentioned, true);
    assert.equal(message.mentioned_me_directly, true);
    assert.equal(message.stream_wildcard_mentioned, false);
    assert.equal(message.topic_wildcard_mentioned, false);
    assert.equal(message.alerted, true);

    flags = ["stream_wildcard_mentioned", "unread"];
    message_store.update_booleans(message, flags);
    assert.equal(message.mentioned, true);
    assert.equal(message.mentioned_me_directly, false);
    assert.equal(message.stream_wildcard_mentioned, true);
    assert.equal(message.topic_wildcard_mentioned, false);

    flags = ["topic_wildcard_mentioned", "unread"];
    message_store.update_booleans(message, flags);
    assert.equal(message.mentioned, true);
    assert.equal(message.mentioned_me_directly, false);
    assert.equal(message.stream_wildcard_mentioned, false);
    assert.equal(message.topic_wildcard_mentioned, true);

    flags = ["read"];
    message_store.update_booleans(message, flags);
    assert.equal(message.mentioned, false);
    assert.equal(message.mentioned_me_directly, false);
    assert.equal(message.alerted, false);
    assert.equal(message.stream_wildcard_mentioned, false);
    assert.equal(message.topic_wildcard_mentioned, false);

    // Make sure we don't muck with unread.
    message.unread = false;
    flags = [""];
    message_store.update_booleans(message, flags);
    assert.equal(message.unread, false);

    message.unread = true;
    flags = ["read"];
    message_store.update_booleans(message, flags);
    assert.equal(message.unread, true);
});

test("update_property", () => {
    let message1 = {
        type: "stream",
        sender_full_name: alice.full_name,
        sender_id: alice.user_id,
        small_avatar_url: "alice_url",
        stream_id: devel.stream_id,
        topic: "",
        display_recipient: devel.name,
        id: 100,
    };
    let message2 = {
        type: "stream",
        sender_full_name: bob.full_name,
        sender_id: bob.user_id,
        small_avatar_url: "bob_url",
        stream_id: denmark.stream_id,
        topic: "",
        display_recipient: denmark.name,
        id: 101,
    };
    message1 = message_helper.process_new_message(message1);
    message2 = message_helper.process_new_message(message2);

    assert.equal(message1.sender_full_name, alice.full_name);
    assert.equal(message2.sender_full_name, bob.full_name);
    message_store.update_sender_full_name(bob.user_id, "Bobby");
    assert.equal(message1.sender_full_name, alice.full_name);
    assert.equal(message2.sender_full_name, "Bobby");

    assert.equal(message1.small_avatar_url, "alice_url");
    assert.equal(message2.small_avatar_url, "bob_url");
    message_store.update_small_avatar_url(bob.user_id, "bobby_url");
    assert.equal(message1.small_avatar_url, "alice_url");
    assert.equal(message2.small_avatar_url, "bobby_url");

    assert.equal(message1.stream_id, devel.stream_id);
    assert.equal(message1.display_recipient, devel.name);
    assert.equal(message2.stream_id, denmark.stream_id);
    assert.equal(message2.display_recipient, denmark.name);
    message_store.update_stream_name(devel.stream_id, "Prod");
    assert.equal(message1.stream_id, devel.stream_id);
    assert.equal(message1.display_recipient, "Prod");
    assert.equal(message2.stream_id, denmark.stream_id);
    assert.equal(message2.display_recipient, denmark.name);
});

test("remove", () => {
    const message1 = {
        type: "stream",
        sender_full_name: alice.full_name,
        sender_id: alice.user_id,
        stream_id: devel.stream_id,
        stream: devel.name,
        display_recipient: devel.name,
        topic: "test",
        id: 100,
    };
    const message2 = {
        type: "stream",
        sender_full_name: bob.full_name,
        sender_id: bob.user_id,
        stream_id: denmark.stream_id,
        stream: denmark.name,
        display_recipient: denmark.name,
        topic: "test",
        id: 101,
    };
    const message3 = {
        type: "stream",
        sender_full_name: cindy.full_name,
        sender_id: cindy.user_id,
        stream_id: denmark.stream_id,
        stream: denmark.name,
        display_recipient: denmark.name,
        topic: "test",
        id: 102,
    };
    for (const message of [message1, message2]) {
        message_helper.process_new_message(message);
    }

    const deleted_message_ids = [message1.id, message3.id, 104];
    message_store.remove(deleted_message_ids);
    assert.equal(message_store.get(message1.id), undefined);
    assert.equal(message_store.get(message2.id).id, message2.id);
    assert.equal(message_store.get(message3.id), undefined);
});

test("get_message_ids_in_stream", () => {
    const message1 = {
        type: "stream",
        sender_full_name: alice.full_name,
        sender_id: alice.user_id,
        stream_id: devel.stream_id,
        stream: devel.name,
        display_recipient: devel.name,
        topic: "test",
        id: 100,
    };
    const message2 = {
        sender_email: "me@example.com",
        sender_id: me.user_id,
        type: "private",
        display_recipient: convert_recipients([me, bob, cindy]),
        flags: ["has_alert_word"],
        is_me_message: false,
        id: 101,
    };
    const message3 = {
        type: "stream",
        sender_full_name: cindy.full_name,
        sender_id: cindy.user_id,
        stream_id: denmark.stream_id,
        stream: denmark.name,
        display_recipient: denmark.name,
        topic: "test",
        id: 102,
    };
    const message4 = {
        type: "stream",
        sender_full_name: me.full_name,
        sender_id: me.user_id,
        stream_id: devel.stream_id,
        stream: devel.name,
        display_recipient: devel.name,
        topic: "test",
        id: 103,
    };

    for (const message of [message1, message2, message3, message4]) {
        message_helper.process_new_message(message);
    }

    assert.deepEqual(message_store.get_message_ids_in_stream(devel.stream_id), [100, 103]);
    assert.deepEqual(message_store.get_message_ids_in_stream(denmark.stream_id), [102]);
});
